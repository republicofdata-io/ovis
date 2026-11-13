/**
 * RoD fork: a path pasted into the chief of staff's composer, sent from the PC this app runs on to
 * `~/incoming` on the remote PC that pane lives on, over the SSH connection this app already holds
 * to that PC (server/ssh.ts muxCommand). Nothing on the remote PC reaches this one.
 *
 * The pasted path is untrusted text. It reaches rsync as one argument of an argv (Bun.spawn, no
 * shell here), and the remote side is told only a name this module made (shared/rod-send-path.ts
 * incomingName: letters, digits, `.`, `_`, `-`) and, with rsync 3, through `-s` as well. The source
 * path goes to the remote PC only on stdin, to remember which send a name belongs to, and is never
 * evaluated there. Copies are resumable (`--partial`, and `--append-verify` with rsync 3): sending
 * the same path again picks up where an interrupted copy stopped. Symbolic links inside a folder
 * are skipped, so nothing outside the chosen folder leaves.
 */
import { randomUUID } from "node:crypto";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import type { Machine } from "../shared/machines.ts";
import { LOCAL_MACHINE } from "../shared/machines.ts";
import { alertingAgent } from "../shared/rod-pods.ts";
import { CHIEF_AGENT, INCOMING_DIR, incomingName, plausiblePath, type SendPathJob, type SendPathOffer } from "../shared/rod-send-path.ts";
import { badRequest, isJsonObject, jsonResponse, readJsonObject } from "./http.ts";
import { shellQuote } from "./machine-security.ts";
import type { MachineManager } from "./machines.ts";

/** What a send needs from the SSH connection to the remote PC (server/ssh.ts SshConnection). */
export interface SendLink {
  destination: string;
  /** an ssh command riding the existing connection, for rsync's `-e`; null when there is none */
  rsh(): string[] | null;
  /** a fixed script in the remote shell, with optional stdin */
  run(script: string, input?: Uint8Array): Promise<string>;
}

export interface RsyncTool {
  path: string;
  major: number;
  minor: number;
}

export interface SendPathDeps {
  machines(): Machine[];
  link(machineId: string): SendLink | undefined;
  rsync?: () => Promise<RsyncTool | null>;
  now?: () => Date;
  home?: string;
  /** tests only: more rsync options (a bandwidth limit, to interrupt a copy midway) */
  extraArgs?: string[];
}

const MEASURE_CHECK_MS = 1_500;
const MEASURE_SEND_MS = 60_000;
const KEEP_FINISHED_MS = 60 * 60_000;
const MAX_JOBS = 50;
const NAME_TRIES = 9;
/** where the remote PC keeps which source each name in ~/incoming came from */
const SOURCES_DIR = ".local/state/ovis-sent";

/** `rsync  version 3.2.7  protocol version 31`, or openrsync's `rsync version 2.6.9 compatible` */
export function rsyncVersion(text: string): { major: number; minor: number } | null {
  const match = /rsync\s+version\s+v?(\d+)\.(\d+)/i.exec(text);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

/** rsync 3 or later protects remote arguments (`-s`) and appends to a partial file (`--append-verify`). */
function modern(tool: RsyncTool): boolean {
  return tool.major >= 3;
}

/** The newest rsync on this PC: Homebrew's before the system's, which on a Mac is the old 2.6.9 or openrsync. */
export async function findRsync(candidates: readonly string[] = ["/opt/homebrew/bin/rsync", "/usr/local/bin/rsync", Bun.which("rsync") ?? "", "/usr/bin/rsync"]): Promise<RsyncTool | null> {
  let best: RsyncTool | null = null;
  for (const path of new Set(candidates.filter(Boolean))) {
    try {
      const proc = Bun.spawn([path, "--version"], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
      const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      const version = rsyncVersion(out + "\n" + err);
      if (version && (!best || version.major > best.major || version.major === best.major && version.minor > best.minor)) best = { path, ...version };
    } catch {
      // not there
    }
  }
  return best;
}

/**
 * rsync's argv: no shell runs it. The source is an absolute path (it cannot read as an option or as
 * `host:path`, and `--` ends the options anyway); a folder's copy goes into the folder named `name`.
 */
export function rsyncArgs(tool: RsyncTool, rsh: readonly string[], destination: string, source: string, kind: "file" | "folder", name: string, extra: readonly string[] = []): string[] {
  if (!source.startsWith("/")) throw new Error("The path must be absolute");
  // rsync splits -e on whitespace and reads quotes; ours has neither
  if (rsh.some((part) => part === "" || /[\s'"\\]/.test(part))) throw new Error("The SSH connection cannot be used by rsync");
  if (/[\s:'"\\]/.test(destination) || destination.startsWith("-")) throw new Error("The PC's SSH address cannot be used by rsync");
  const remote = `${destination}:${INCOMING_DIR}/${name}${kind === "folder" ? "/" : ""}`;
  return [
    tool.path, "-rt", "--partial", "--progress",
    ...(modern(tool) ? ["-s", "--append-verify"] : []),
    "-e", rsh.join(" "),
    ...extra,
    "--", kind === "folder" ? source.replace(/\/*$/, "/") : source, remote,
  ];
}

/**
 * Bytes sent, from `--progress`: a line per update (`  1,048,576  42%  …`), and the file's last one
 * ending `(xfr#3, …)` (`xfer#` before rsync 3.1). Files already there are not printed, so a resumed
 * copy counts what this run sends.
 */
export class ProgressReader {
  private completed = 0;
  private current = 0;
  private rest = "";
  get done(): number { return this.completed + this.current; }
  feed(chunk: string): number {
    const lines = (this.rest + chunk).split(/[\r\n]/);
    this.rest = lines.pop() ?? "";
    for (const line of lines) {
      const match = /^\s*(\d[\d,.' ]*?)\s+\d{1,3}%/.exec(line);
      if (!match) continue;
      const bytes = Number(match[1]!.replace(/\D/g, ""));
      if (/\(xfe?r#\d+/.test(line)) { this.completed += bytes; this.current = 0; } else this.current = bytes;
    }
    return this.done;
  }
}

/** The regular files under a path and their size, as rsync without `-l` sends them (links skipped); null once the deadline passed. */
export async function measure(path: string, deadline: number): Promise<number | null> {
  const info = await lstat(path);
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  let bytes = 0;
  const folders = [path];
  while (folders.length > 0) {
    if (Date.now() > deadline) return null;
    const folder = folders.pop()!;
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) folders.push(full);
      else if (entry.isFile()) { try { bytes += (await lstat(full)).size; } catch { /* gone meanwhile */ } }
    }
  }
  return bytes;
}

/** A pasted path on this PC, `~/` expanded and links at its top resolved: what it is, or null when it is not there. */
export async function localPath(path: string, home: string): Promise<{ path: string; kind: "file" | "folder" } | null> {
  if (!plausiblePath(path)) return null;
  const expanded = path.startsWith("~/") ? join(home, path.slice(2)) : path;
  try {
    const real = await realpath(expanded);
    const info = await stat(real);
    if (info.isFile()) return { path: real, kind: "file" };
    if (info.isDirectory()) return { path: real, kind: "folder" };
  } catch {
    // not there, or not readable
  }
  return null;
}

/**
 * The remote script that settles the name: the first of `names` that is free, or already holds this
 * same source (an interrupted send of it, resumed). The source comes on stdin and is only compared.
 * Prints the remote home, then the name.
 */
export function claimScript(names: readonly string[]): string {
  const quoted = names.map(shellQuote).join(" ");
  return [
    "set -e", "cd",
    `mkdir -p -m 700 ${INCOMING_DIR}`, `mkdir -p -m 700 ${SOURCES_DIR}`,
    "src=$(cat)",
    `for n in ${quoted}; do`,
    `  m="${SOURCES_DIR}/$n"`,
    `  if [ -f "$m" ] && [ "$(cat "$m")" = "$src" ]; then printf '%s\\n%s\\n' "$HOME" "$n"; exit 0; fi`,
    `  if [ ! -e "${INCOMING_DIR}/$n" ] && [ ! -e "$m" ]; then printf '%s' "$src" > "$m"; printf '%s\\n%s\\n' "$HOME" "$n"; exit 0; fi`,
    "done",
    "echo 'Too many sends of that name today' >&2; exit 3",
  ].join("\n");
}

interface Running {
  job: SendPathJob;
  machine: string;
  proc: Subprocess | null;
  stopped: boolean;
  ended: number | null;
}

/** rsync's ending in words: its exit code, then the last thing it said. */
export function rsyncFailure(code: number | null, stderr: string): string {
  const said = stderr.trim().split("\n").filter((line) => line.trim() !== "" && !/^skipping non-regular file/.test(line)).at(-1)?.trim();
  if (code === 23) return `Some files could not be read${said ? `: ${said}` : ""}`;
  if (code === 12 || code === 255) return "The connection to the PC was lost. Try again once it is back: the copy picks up where it stopped";
  return said || `rsync stopped (${code ?? "killed"})`;
}

export class SendPaths {
  private jobs = new Map<string, Running>();
  private now: () => Date;
  private home: string;
  private rsync: () => Promise<RsyncTool | null>;
  private tool: Promise<RsyncTool | null> | null = null;

  constructor(private deps: SendPathDeps) {
    this.now = deps.now ?? (() => new Date());
    this.home = deps.home ?? homedir();
    this.rsync = deps.rsync ?? (() => findRsync());
  }

  /** The remote PC, when the pane is the chief of staff's on a PC other than this one; else null. */
  private chiefPc(machineId: string, paneId: string): Machine | null {
    if (machineId === LOCAL_MACHINE) return null;
    const machine = this.deps.machines().find((item) => item.id === machineId);
    if (!machine || machine.kind !== "ssh" || !machine.snapshot) return null;
    const pane = machine.snapshot.panes.find((item) => item.pane_id === paneId);
    if (!pane) return null;
    const name = machine.snapshot.agents?.find((agent) => agent.pane_id === paneId)?.name ?? null;
    return alertingAgent(name, pane.label, [CHIEF_AGENT]) ? machine : null;
  }

  /** The first of the pasted paths that is on this PC, as an offer; null for any other pane. */
  async check(machineId: string, paneId: string, paths: readonly string[]): Promise<SendPathOffer | null> {
    const machine = this.chiefPc(machineId, paneId);
    if (!machine || !this.deps.link(machineId)) return null;
    for (const pasted of paths.slice(0, 4)) {
      const found = await localPath(pasted, this.home);
      if (!found) continue;
      const bytes = await measure(found.path, Date.now() + MEASURE_CHECK_MS).catch(() => null);
      return { path: pasted, name: incomingName(found.path, this.now()), kind: found.kind, bytes, to: machine.name };
    }
    return null;
  }

  get(id: string): SendPathJob | null {
    return this.jobs.get(id)?.job ?? null;
  }

  stop(id: string): SendPathJob | null {
    const running = this.jobs.get(id);
    if (!running) return null;
    if (running.job.state === "preparing" || running.job.state === "copying") {
      running.stopped = true;
      running.proc?.kill();
    }
    return running.job;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, running] of this.jobs) if (running.ended !== null && now - running.ended > KEEP_FINISHED_MS) this.jobs.delete(id);
    while (this.jobs.size > MAX_JOBS) {
      const oldest = [...this.jobs].find(([, running]) => running.ended !== null);
      if (!oldest) break;
      this.jobs.delete(oldest[0]);
    }
  }

  /** Starts sending one pasted path, or returns the send of it already running. */
  async start(machineId: string, paneId: string, pasted: string): Promise<SendPathJob | { refused: string }> {
    const machine = this.chiefPc(machineId, paneId);
    if (!machine) return { refused: "Paths can be sent only from the chief of staff's pane on another PC" };
    const link = this.deps.link(machineId);
    if (!link) return { refused: `${machine.name} is not connected` };
    const found = await localPath(pasted, this.home);
    if (!found) return { refused: "That path is not on this computer" };
    this.prune();
    for (const running of this.jobs.values()) {
      if (running.machine === machineId && running.job.path === pasted && (running.job.state === "preparing" || running.job.state === "copying")) return running.job;
    }
    const job: SendPathJob = { id: randomUUID(), path: pasted, name: incomingName(found.path, this.now()), state: "preparing", done: 0, total: null, remote: null, error: null };
    const running: Running = { job, machine: machineId, proc: null, stopped: false, ended: null };
    this.jobs.set(job.id, running);
    void this.run(running, link, found).catch((error: unknown) => this.end(running, "failed", error instanceof Error ? error.message : String(error)));
    return job;
  }

  private end(running: Running, state: "done" | "failed" | "stopped", error: string | null = null): void {
    running.job.state = running.stopped && state !== "done" ? "stopped" : state;
    running.job.error = running.job.state === "failed" ? error : null;
    running.proc = null;
    running.ended = Date.now();
  }

  private async run(running: Running, link: SendLink, found: { path: string; kind: "file" | "folder" }): Promise<void> {
    const { job } = running;
    this.tool ??= this.rsync();
    const tool = await this.tool;
    if (!tool) { this.tool = null; return this.end(running, "failed", "rsync is not installed on this computer"); }
    job.total = await measure(found.path, Date.now() + MEASURE_SEND_MS).catch(() => null);
    if (running.stopped) return this.end(running, "stopped");
    const names = [job.name, ...Array.from({ length: NAME_TRIES - 1 }, (_, index) => `${job.name}-${index + 2}`)];
    const claimed = (await link.run(claimScript(names), new TextEncoder().encode(found.path))).trim().split("\n");
    const home = claimed[0]?.trim();
    const name = claimed[1]?.trim();
    if (!home?.startsWith("/") || !name || !names.includes(name)) return this.end(running, "failed", "The PC did not say where to put the copy");
    job.name = name;
    job.remote = `${home.replace(/\/+$/, "")}/${INCOMING_DIR}/${name}`;
    if (running.stopped) return this.end(running, "stopped");
    const rsh = link.rsh();
    if (!rsh) return this.end(running, "failed", "The SSH connection to the PC is down; send again once it is back");
    const proc = Bun.spawn(rsyncArgs(tool, rsh, link.destination, found.path, found.kind, name, this.deps.extraArgs), { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    running.proc = proc;
    job.state = "copying";
    const progress = new ProgressReader();
    const decoder = new TextDecoder();
    const reading = (async () => {
      for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) job.done = progress.feed(decoder.decode(chunk, { stream: true }));
    })();
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited, reading]);
    // 24: files vanished while sent, which is what a recording that is still written does
    if (code === 0 || code === 24) {
      if (job.total !== null) job.done = Math.max(job.done, job.total);
      return this.end(running, "done");
    }
    this.end(running, "failed", rsyncFailure(proc.signalCode ? null : code, stderr));
  }
}

function field(payload: Record<string, unknown>, name: string): string | null {
  const value = payload[name];
  return typeof value === "string" && value !== "" && value.length <= 1024 ? value : null;
}

/** /api/rod/send-path/{check,send,stop} (POST) and /api/rod/send-path/job (GET). */
export async function handleRodSendPathRequest(request: Request, url: URL, sends: SendPaths | null): Promise<Response> {
  const route = url.pathname.slice("/api/rod/send-path/".length);
  if (!sends) return jsonResponse({ offer: null });
  if (route === "job" && request.method === "GET") {
    const job = sends.get(url.searchParams.get("id") ?? "");
    return job ? jsonResponse({ job }) : jsonResponse({ error: { code: "not_found", message: "No such send" } }, 404);
  }
  if (request.method !== "POST" || !["check", "send", "stop"].includes(route)) return jsonResponse({ error: { code: "not_found", message: "not found" } }, 404);
  const payload = await readJsonObject(request);
  if (payload instanceof Response) return payload;
  if (!isJsonObject(payload)) return badRequest("invalid_body", "Expected a JSON object");
  if (route === "stop") {
    const job = sends.stop(field(payload, "id") ?? "");
    return job ? jsonResponse({ job }) : jsonResponse({ error: { code: "not_found", message: "No such send" } }, 404);
  }
  const machine = field(payload, "machine");
  const pane = field(payload, "pane_id");
  if (!machine || !pane) return badRequest("invalid_body", "machine and pane_id are required");
  if (route === "check") {
    const paths = Array.isArray(payload.paths) ? payload.paths.filter((item): item is string => typeof item === "string").slice(0, 4) : [];
    return jsonResponse({ offer: await sends.check(machine, pane, paths) });
  }
  const path = field(payload, "path");
  if (!path) return badRequest("invalid_body", "path is required");
  const started = await sends.start(machine, pane, path);
  return "refused" in started ? jsonResponse({ error: { code: "refused", message: started.refused } }, 409) : jsonResponse({ job: started });
}

const perManager = new WeakMap<MachineManager, SendPaths>();

/** The sends of this server's PCs: one set per MachineManager; none without remote PCs. */
export function sendPathsFor(machines: MachineManager | null | undefined): SendPaths | null {
  if (!machines) return null;
  let sends = perManager.get(machines);
  if (!sends) {
    sends = new SendPaths({
      machines: () => machines.list(),
      link: (id) => {
        const ssh = machines.rodSsh(id);
        return ssh ? { destination: ssh.target.destination, rsh: () => ssh.muxCommand(), run: (script, input) => ssh.run(script, input) } : undefined;
      },
    });
    perManager.set(machines, sends);
  }
  return sends;
}

/**
 * RoD fork: no alert reaches a device while Olivier is at the Mac, as none does while a window of
 * the app is in use (server/push.ts `inUse`). At the desk means: a herdr window is open on this Mac
 * (a herdr client process, not its server or a CLI call) and the keyboard or mouse was used within
 * the last OVIS_ROD_DESK_IDLE_SECONDS. Off unless that setting is there (the Mac's plugin env file sets
 * 300), so tests and other machines never see a desk. macOS only; read every 15 s.
 */
import { spawn } from "node:child_process";

export const DESK_POLL_MS = 15_000;
const READ_TIMEOUT_MS = 2_000;

/** Seconds since the last keyboard or mouse input, from `ioreg -c IOHIDSystem`'s HIDIdleTime (nanoseconds). */
export function parseIdleSeconds(ioreg: string): number | null {
  const match = /"HIDIdleTime"\s*=\s*(\d+)/.exec(ioreg);
  return match ? Number(match[1]) / 1e9 : null;
}

const CLIENT_OPTION_WITH_VALUE = new Set(["--session", "--remote", "--remote-keybindings"]);
const CLIENT_FLAG = new Set(["--handoff"]);

/** Whether `ps -Ao command=` lists a herdr window: `herdr` with only client options, no subcommand. */
export function herdrWindowOpen(ps: string): boolean {
  return ps.split("\n").some((line) => {
    const words = line.trim().split(/\s+/);
    const program = words[0] ?? "";
    if (program !== "herdr" && !program.endsWith("/herdr")) return false;
    for (let index = 1; index < words.length; index += 1) {
      const word = words[index]!;
      if (CLIENT_FLAG.has(word)) continue;
      if (CLIENT_OPTION_WITH_VALUE.has(word) && index + 1 < words.length) { index += 1; continue; }
      return false; // a subcommand (server, agent, pane, …) or an option the window does not take
    }
    return true;
  });
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} timed out`)); }, READ_TIMEOUT_MS);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { out += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", () => { clearTimeout(timer); resolve(out); });
  });
}

export interface DeskReaders {
  idleSeconds: () => Promise<number | null>;
  herdrWindowOpen: () => Promise<boolean>;
}

export const macReaders: DeskReaders = {
  idleSeconds: async () => parseIdleSeconds(await run("ioreg", ["-c", "IOHIDSystem", "-r", "-d", "1", "-k", "HIDIdleTime"])),
  herdrWindowOpen: async () => herdrWindowOpen(await run("ps", ["-Ao", "command="])),
};

/** The desk setting from the environment: seconds of idleness that still count as at the desk; 0 (off) when unset or invalid. */
export function deskIdleSeconds(env: Record<string, string | undefined> = process.env): number {
  const seconds = Number(env["OVIS_ROD_DESK_IDLE_SECONDS"] ?? "");
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export class DeskPresence {
  private atDesk = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly readers: DeskReaders, private readonly idleLimit: number) {}

  /** Whether Olivier is at the Mac, as of the last read; false until the first read and on any failure. */
  present(): boolean {
    return this.atDesk;
  }

  async refresh(): Promise<void> {
    if (this.idleLimit <= 0) { this.atDesk = false; return; }
    try {
      const [idle, open] = await Promise.all([this.readers.idleSeconds(), this.readers.herdrWindowOpen()]);
      this.atDesk = open && idle !== null && idle < this.idleLimit;
    } catch {
      this.atDesk = false;
    }
  }

  start(pollMs = DESK_POLL_MS): void {
    if (this.timer !== null || this.idleLimit <= 0) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), pollMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}

/** The desk check this server runs: on macOS with the setting on, else one that is never present. */
export function startDeskPresence(env: Record<string, string | undefined> = process.env, platform = process.platform): DeskPresence {
  const desk = new DeskPresence(macReaders, platform === "darwin" ? deskIdleSeconds(env) : 0);
  desk.start();
  return desk;
}

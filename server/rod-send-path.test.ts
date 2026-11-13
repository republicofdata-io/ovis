import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Machine } from "../shared/machines.ts";
import type { SendPathJob } from "../shared/rod-send-path.ts";
import { claimScript, findRsync, ProgressReader, rsyncArgs, rsyncVersion, SendPaths, type RsyncTool, type SendLink } from "./rod-send-path.ts";

const root = mkdtempSync(join(tmpdir(), "rod-send-path-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const day = new Date(2026, 10, 12, 9, 30);
const modernTool: RsyncTool = { path: "rsync", major: 3, minor: 2 };
const legacyTool: RsyncTool = { path: "/usr/bin/rsync", major: 2, minor: 6 };
/** the rsync this PC has: on a Mac without Homebrew's, the system's 2.6.9 or openrsync, whose flags the legacy runs use */
const local = await findRsync();
if (!local) throw new Error("these tests need rsync");
const legacyLocal: RsyncTool = { ...local, major: 2 };

/** a remote PC whose pane `w1:p1` is the chief of staff's and `w1:p2` a pod's lead */
const pc = (id = "demo-pc"): Machine => ({
  id, name: "Demo PC", kind: "ssh", enabled: true, state: "connected", error: null,
  snapshot: {
    panes: [{ pane_id: "w1:p1", label: null }, { pane_id: "w1:p2", label: null }],
    agents: [{ pane_id: "w1:p1", name: "rod-chief" }, { pane_id: "w1:p2", name: "demo-pm" }],
  } as unknown as Machine["snapshot"],
});

/**
 * A stand-in for the remote PC over ssh, in a folder of its own: the ssh it hands rsync drops its
 * options and the host, then runs the command through a shell, as sshd runs a remote command. So an
 * argument that reached the remote shell unprotected would run there.
 */
function remotePc(): { home: string; link: SendLink } {
  const base = mkdtempSync(join(root, "pc-"));
  const home = join(base, "home");
  mkdirSync(home);
  const ssh = join(base, "ssh");
  writeFileSync(ssh, `#!/bin/sh
while [ $# -gt 0 ]; do case "$1" in -S|-o|-l|-p|-i) shift 2;; -*) shift;; *) break;; esac; done
shift
cd '${home}' && HOME='${home}' exec sh -c "$*"
`);
  chmodSync(ssh, 0o755);
  return {
    home,
    link: {
      destination: "demo@demo-pc",
      rsh: () => [ssh, "-S", join(base, "control"), "-o", "BatchMode=yes"],
      run: async (script, input) => {
        const proc = Bun.spawn(["sh", "-c", script], { cwd: home, env: { ...process.env, HOME: home }, stdin: input ? new Blob([new Uint8Array(input)]) : "ignore", stdout: "pipe", stderr: "pipe" });
        const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        if (code !== 0) throw new Error(err.trim() || `exit ${code}`);
        return out;
      },
    },
  };
}

async function until(sends: SendPaths, id: string, done: (job: SendPathJob) => boolean, ms = 20_000): Promise<SendPathJob> {
  const deadline = Date.now() + ms;
  for (;;) {
    const job = sends.get(id)!;
    if (done(job)) return job;
    if (Date.now() > deadline) throw new Error(`send stuck at ${JSON.stringify(job)}`);
    await Bun.sleep(25);
  }
}

const ended = (job: SendPathJob) => job.state === "done" || job.state === "failed" || job.state === "stopped";

function sendsFor(link: SendLink, tool: RsyncTool | null, extraArgs: string[] = [], machine = pc()): SendPaths {
  return new SendPaths({ machines: () => [machine], link: (id) => (id === machine.id ? link : undefined), rsync: async () => tool, now: () => day, home: root, extraArgs });
}

describe("rsync", () => {
  it("reads its version, openrsync's included", () => {
    expect(rsyncVersion("rsync  version 3.2.7  protocol version 31\nCopyright")).toEqual({ major: 3, minor: 2 });
    expect(rsyncVersion("openrsync: protocol version 29\nrsync version 2.6.9 compatible")).toEqual({ major: 2, minor: 6 });
    expect(rsyncVersion("nothing")).toBeNull();
  });

  it("is given the pasted path as one argument after `--`, and protected arguments when it is rsync 3", () => {
    const args = rsyncArgs(modernTool, ["ssh", "-S", "/tmp/c"], "demo@demo-pc", "/Volumes/DEMO/Screen Recordings/-rf $(x)", "folder", "2026-11-12-rf-x");
    expect(args).toEqual(["rsync", "-rt", "--partial", "--progress", "-s", "--append-verify", "-e", "ssh -S /tmp/c", "--", "/Volumes/DEMO/Screen Recordings/-rf $(x)/", "demo@demo-pc:incoming/2026-11-12-rf-x/"]);
    expect(rsyncArgs(legacyTool, ["ssh"], "demo-pc", "/a/file.mov", "file", "2026-11-12-file.mov")).toEqual(["/usr/bin/rsync", "-rt", "--partial", "--progress", "-e", "ssh", "--", "/a/file.mov", "demo-pc:incoming/2026-11-12-file.mov"]);
  });

  it("refuses a relative path and an ssh command it would split differently", () => {
    expect(() => rsyncArgs(modernTool, ["ssh"], "demo-pc", "-rf", "file", "2026-11-12-rf")).toThrow();
    expect(() => rsyncArgs(modernTool, ["ssh", "-S", "/tmp/a b"], "demo-pc", "/a/b", "file", "2026-11-12-b")).toThrow();
    expect(() => rsyncArgs(modernTool, ["ssh"], "-oProxyCommand=x", "/a/b", "file", "2026-11-12-b")).toThrow();
  });

});

describe("progress", () => {
  it("counts finished files and the one under way, across chunks", () => {
    const reader = new ProgressReader();
    reader.feed("a.mov\n      32,768   0%    0.00kB/s    0:00:00\r   1,0");
    expect(reader.done).toBe(32_768);
    reader.feed("48,576 100%   10.00MB/s    0:00:00 (xfr#1, to-chk=1/3)\nb.mov\n");
    expect(reader.done).toBe(1_048_576);
    reader.feed("        2048  50%  0.00kB/s  0:00:00\r        4096 100%  0.00kB/s  0:00:00 (xfer#2, to-check=0/3)\n");
    expect(reader.done).toBe(1_052_672);
  });
});

describe("who can send", () => {
  it("only the chief of staff's pane on another PC", async () => {
    const { link } = remotePc();
    const folder = mkdtempSync(join(root, "chosen-"));
    const sends = sendsFor(link, local);
    expect(await sends.check("demo-pc", "w1:p1", [folder])).toMatchObject({ path: folder, kind: "folder", bytes: 0, to: "Demo PC" });
    expect(await sends.check("demo-pc", "w1:p2", [folder])).toBeNull();
    expect(await sends.check("local", "w1:p1", [folder])).toBeNull();
    expect(await sends.start("demo-pc", "w1:p2", folder)).toEqual({ refused: expect.any(String) });
  });

  it("a path that is on this PC, the first that is", async () => {
    const { link } = remotePc();
    const file = join(mkdtempSync(join(root, "chosen-")), "notes.md");
    writeFileSync(file, "hello");
    const sends = sendsFor(link, local);
    expect(await sends.check("demo-pc", "w1:p1", ["/nowhere/at/all", file])).toMatchObject({ path: file, name: "2026-11-12-notes.md", kind: "file", bytes: 5 });
    expect(await sends.check("demo-pc", "w1:p1", ["/nowhere/at/all"])).toBeNull();
  });
});

describe("a send", () => {
  for (const tool of local.major >= 3 ? [local, legacyLocal] : [legacyLocal]) {
    it(`copies only the chosen folder, and nothing in its name runs anywhere (rsync ${tool.major})`, async () => {
      const { home, link } = remotePc();
      const parent = mkdtempSync(join(root, "chosen-"));
      const folder = join(parent, `-rf $(touch PWNED) 'q" \`touch PWNED2\` x`);
      mkdirSync(join(folder, "inner $(touch PWNED3)"), { recursive: true });
      writeFileSync(join(folder, "take 1.mov"), "frames");
      writeFileSync(join(folder, "inner $(touch PWNED3)", "; touch PWNED4"), "more");
      const outside = join(parent, "outside.txt");
      writeFileSync(outside, "never sent");
      symlinkSync(outside, join(folder, "link-out"));
      const sends = sendsFor(link, tool);
      const started = await sends.start("demo-pc", "w1:p1", folder);
      if ("refused" in started) throw new Error(started.refused);
      const job = await until(sends, started.id, ended);
      expect(job.error).toBeNull();
      expect(job.state).toBe("done");
      expect(job.name).toBe("2026-11-12-rf-touch-PWNED-q-touch-PWNED2-x");
      expect(job.remote).toBe(join(home, "incoming", job.name));
      expect(readFileSync(join(job.remote!, "take 1.mov"), "utf8")).toBe("frames");
      expect(readFileSync(join(job.remote!, "inner $(touch PWNED3)", "; touch PWNED4"), "utf8")).toBe("more");
      expect(existsSync(join(job.remote!, "link-out"))).toBe(false);
      const everywhere = [home, join(home, "incoming"), parent, process.cwd()].flatMap((dir) => readdirSync(dir));
      expect(everywhere.filter((name) => name.startsWith("PWNED"))).toEqual([]);
    });
  }

  it("gives another path of the same name its own folder, and the same path the same one", async () => {
    const { home, link } = remotePc();
    const first = join(mkdtempSync(join(root, "chosen-")), "demo");
    const second = join(mkdtempSync(join(root, "chosen-")), "demo");
    for (const dir of [first, second]) { mkdirSync(dir); writeFileSync(join(dir, "a.txt"), dir); }
    const sends = sendsFor(link, local);
    const names: string[] = [];
    for (const path of [first, second, first]) {
      const started = await sends.start("demo-pc", "w1:p1", path);
      if ("refused" in started) throw new Error(started.refused);
      names.push((await until(sends, started.id, ended)).name);
    }
    expect(names).toEqual(["2026-11-12-demo", "2026-11-12-demo-2", "2026-11-12-demo"]);
    expect(readFileSync(join(home, "incoming", "2026-11-12-demo-2", "a.txt"), "utf8")).toBe(second);
  });

  // --bwlimit and --append-verify are rsync 3's; a Mac's system rsync resumes from its --partial file instead
  it.skipIf(local.major < 3)("resumes an interrupted copy where it stopped", async () => {
    const { home, link } = remotePc();
    const file = join(mkdtempSync(join(root, "chosen-")), "recording.mov");
    const bytes = new Uint8Array(8 * 1024 * 1024).map((_, index) => (index * 7) % 251);
    writeFileSync(file, bytes);
    // slowed to about four seconds, and stopped once the receiver holds part of it (rsync 3 writes it in place)
    const slow = sendsFor(link, local, ["--bwlimit=2000"]);
    const started = await slow.start("demo-pc", "w1:p1", file);
    if ("refused" in started) throw new Error(started.refused);
    const incoming = join(home, "incoming");
    const receiving = () => existsSync(incoming) && readdirSync(incoming).some((name) => name.includes("2026-11-12-recording.mov") && statSync(join(incoming, name)).size > 256 * 1024);
    const begun = Date.now() + 10_000;
    while (!receiving()) { if (Date.now() > begun || ended(slow.get(started.id)!)) throw new Error("the copy never got under way"); await Bun.sleep(25); }
    expect(slow.stop(started.id)?.id).toBe(started.id);
    expect((await until(slow, started.id, ended)).state).toBe("stopped");
    const target = join(home, "incoming", "2026-11-12-recording.mov");
    // the receiver keeps what it had once the sender is gone
    const deadline = Date.now() + 5_000;
    while (!existsSync(target)) { if (Date.now() > deadline) throw new Error("no partial file"); await Bun.sleep(25); }
    const partial = statSync(target).size;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(bytes.length);

    const sends = sendsFor(link, local);
    const again = await sends.start("demo-pc", "w1:p1", file);
    if ("refused" in again) throw new Error(again.refused);
    const job = await until(sends, again.id, ended);
    expect(job.state).toBe("done");
    expect(job.name).toBe("2026-11-12-recording.mov");
    expect(new Uint8Array(readFileSync(target))).toEqual(bytes);
  });

  it("says when this PC has no rsync", async () => {
    const { link } = remotePc();
    const file = join(mkdtempSync(join(root, "chosen-")), "a.txt");
    writeFileSync(file, "x");
    const sends = sendsFor(link, null);
    const started = await sends.start("demo-pc", "w1:p1", file);
    if ("refused" in started) throw new Error(started.refused);
    expect(await until(sends, started.id, ended)).toMatchObject({ state: "failed", error: "rsync is not installed on this computer" });
  });
});

describe("the name on the remote PC", () => {
  it("is settled by a script that only compares the source it reads on stdin", () => {
    const script = claimScript(["2026-11-12-a", "2026-11-12-a-2"]);
    expect(script).toContain("src=$(cat)");
    expect(script).toContain("for n in '2026-11-12-a' '2026-11-12-a-2'; do");
  });
});

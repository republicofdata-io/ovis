import { describe, expect, it } from "bun:test";
import { DeskPresence, deskIdleSeconds, herdrWindowOpen, parseIdleSeconds, sshReaders } from "./rod-desk.ts";

describe("desk signals", () => {
  it("reads the idle time ioreg reports in nanoseconds", () => {
    expect(parseIdleSeconds('    |   "HIDIdleTime" = 14045550625\n')).toBeCloseTo(14.05, 1);
    expect(parseIdleSeconds("no such key")).toBeNull();
  });

  it("finds a herdr window, not its server or a command-line call", () => {
    expect(herdrWindowOpen("/usr/bin/login\nherdr\n")).toBe(true);
    expect(herdrWindowOpen("/home/demo/.local/bin/herdr --session work\n")).toBe(true);
    expect(herdrWindowOpen("herdr --remote demo-box --handoff\n")).toBe(true);
    expect(herdrWindowOpen("/home/demo/.local/bin/herdr server\nherdr --session work server\n")).toBe(false);
    expect(herdrWindowOpen("herdr agent prompt demo-eng hello --wait\nherdr pane list\n")).toBe(false);
    expect(herdrWindowOpen("/usr/bin/herdrsomething\nvim herdr\n")).toBe(false);
  });

  it("is off unless the setting holds a positive number of seconds", () => {
    expect(deskIdleSeconds({})).toBe(0);
    expect(deskIdleSeconds({ OVIS_ROD_DESK_IDLE_SECONDS: "300" })).toBe(300);
    expect(deskIdleSeconds({ OVIS_ROD_DESK_IDLE_SECONDS: "0" })).toBe(0);
    expect(deskIdleSeconds({ OVIS_ROD_DESK_IDLE_SECONDS: "soon" })).toBe(0);
  });
});

describe("desk presence", () => {
  const readers = (idle: number | null, open: boolean) => ({ idleSeconds: async () => idle, herdrWindowOpen: async () => open });

  it("is present with herdr open and input within the limit", async () => {
    const desk = new DeskPresence(readers(120, true), 300);
    expect(desk.present()).toBe(false);
    await desk.refresh();
    expect(desk.present()).toBe(true);
  });

  it("is away after the limit, without a herdr window, when off, or when a read fails", async () => {
    for (const desk of [
      new DeskPresence(readers(301, true), 300),
      new DeskPresence(readers(10, false), 300),
      new DeskPresence(readers(null, true), 300),
      new DeskPresence(readers(10, true), 0),
      new DeskPresence({ idleSeconds: async () => { throw new Error("no ioreg"); }, herdrWindowOpen: async () => true }, 300),
    ]) {
      await desk.refresh();
      expect(desk.present()).toBe(false);
    }
  });
});

describe("a Mac's desk over SSH", () => {
  it("reads both signals in one SSH call", async () => {
    const calls: string[][] = [];
    const runner = async (command: string, args: string[]) => { calls.push([command, ...args]); return '"HIDIdleTime" = 30000000000\n----ps----\nherdr\nherdr server\n'; };
    const readers = sshReaders("demo-mac", runner);
    const [idle, open] = await Promise.all([readers.idleSeconds(), readers.herdrWindowOpen()]);
    expect(idle).toBe(30);
    expect(open).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]!.slice(0, 6)).toEqual(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "demo-mac"]);
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { PreferenceStore } from "./preferences.ts";
import { PodMutes } from "./rod-pod-mutes.ts";

type Pane = SessionSnapshot["panes"][number];
type Agent = NonNullable<SessionSnapshot["agents"]>[number];

const dirs: string[] = [];
function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rod-pod-mutes-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function pane(pane_id: string, fields: Partial<Pane> = {}): Pane {
  return { pane_id, workspace_id: "w1", tab_id: "w1:t1", terminal_id: `term-${pane_id}`, agent: "claude", agent_status: "idle", focused: false, ...fields } as Pane;
}
function agent(pane_id: string, name: string): Agent {
  return { pane_id, name, agent: "claude", agent_status: "idle" } as Agent;
}

describe("pod mutes", () => {
  it("mutes pod engineers and designers, never the product manager or agents in no pod", () => {
    const dir = stateDir();
    const preferences = new PreferenceStore(dir);
    const mutes = new PodMutes(preferences, dir);
    mutes.observe({
      panes: [pane("w1:p1"), pane("w1:p2"), pane("w1:p3", { label: "design" }), pane("w1:p4"), pane("w1:p5", { label: "eng", agent: null })],
      agents: [agent("w1:p1", "demo-pm"), agent("w1:p2", "demo-eng-2"), agent("w1:p4", "reviewer")],
    });
    expect(preferences.get().muted_panes).toEqual(["w1:p2", "w1:p3"]);
  });

  it("keeps a mute undone by hand undone, across a restart", () => {
    const dir = stateDir();
    const preferences = new PreferenceStore(dir);
    const snapshot = { panes: [pane("w1:p2")], agents: [agent("w1:p2", "demo-eng")] };
    new PodMutes(preferences, dir).observe(snapshot);
    expect(preferences.get().muted_panes).toEqual(["w1:p2"]);
    preferences.set({ settings: {}, muted_panes: [] });
    const again = new PodMutes(new PreferenceStore(dir), dir);
    again.observe(snapshot);
    expect(new PreferenceStore(dir).get().muted_panes).toEqual([]);
  });

  it("lifts its mute when another agent takes the pane, and leaves other mutes alone", () => {
    const dir = stateDir();
    const preferences = new PreferenceStore(dir);
    preferences.set({ settings: {}, muted_panes: ["w1:p9"] });
    const mutes = new PodMutes(preferences, dir);
    mutes.observe({ panes: [pane("w1:p2"), pane("w1:p9")], agents: [agent("w1:p2", "demo-eng")] });
    expect(preferences.get().muted_panes).toEqual(["w1:p9", "w1:p2"]);
    mutes.observe({ panes: [pane("w1:p2", { agent: "codex" }), pane("w1:p9")], agents: [agent("w1:p2", "solo")] });
    expect(preferences.get().muted_panes).toEqual(["w1:p9"]);
  });

  it("writes nothing while nothing changes", () => {
    const dir = stateDir();
    const preferences = new PreferenceStore(dir);
    const mutes = new PodMutes(preferences, dir);
    const snapshot = { panes: [pane("w1:p2")], agents: [agent("w1:p2", "demo-eng")] };
    mutes.observe(snapshot);
    const revision = preferences.get().revision;
    mutes.observe(snapshot);
    expect(preferences.get().revision).toBe(revision);
  });
});

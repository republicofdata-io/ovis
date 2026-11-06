import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { PreferenceStore } from "./preferences.ts";
import { PodMutes, alertingAgentsFromEnv } from "./rod-pod-mutes.ts";

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
  it("mutes every agent but the chief of staff's pane; a pane with no agent is left alone", () => {
    const dir = stateDir();
    const preferences = new PreferenceStore(dir);
    const mutes = new PodMutes(preferences, dir);
    mutes.observe({
      panes: [pane("w1:p1"), pane("w1:p2"), pane("w1:p3", { label: "design" }), pane("w1:p4"), pane("w1:p5", { label: "eng", agent: null }), pane("w1:p6")],
      agents: [agent("w1:p1", "demo-pm"), agent("w1:p2", "demo-eng-2"), agent("w1:p4", "reviewer"), agent("w1:p6", "rod-chief")],
    });
    expect(preferences.get().muted_panes).toEqual(["w1:p1", "w1:p2", "w1:p3", "w1:p4"]);
  });

  it("reads the alerting names from the environment, or defaults to the chief", () => {
    expect(alertingAgentsFromEnv({})).toEqual(["rod-chief"]);
    expect(alertingAgentsFromEnv({ OVIS_ROD_ALERT_AGENTS: " Demo-PM, rod-chief ,, " })).toEqual(["demo-pm", "rod-chief"]);
    const dir = stateDir();
    const preferences = new PreferenceStore(dir);
    new PodMutes(preferences, dir, ["demo-pm"]).observe({ panes: [pane("w1:p1"), pane("w1:p6")], agents: [agent("w1:p1", "demo-pm"), agent("w1:p6", "rod-chief")] });
    expect(preferences.get().muted_panes).toEqual(["w1:p6"]);
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
    mutes.observe({ panes: [pane("w1:p2"), pane("w1:p9", { agent: null })], agents: [agent("w1:p2", "demo-eng")] });
    expect(preferences.get().muted_panes).toEqual(["w1:p9", "w1:p2"]);
    mutes.observe({ panes: [pane("w1:p2", { agent: "codex" }), pane("w1:p9", { agent: null })], agents: [agent("w1:p2", "rod-chief")] });
    expect(preferences.get().muted_panes).toEqual(["w1:p9"]);
  });

  it("lifts its mute when the pane is gone, so a pane id reused later starts unmuted", () => {
    const dir = stateDir();
    const preferences = new PreferenceStore(dir);
    preferences.set({ settings: {}, muted_panes: ["w1:p9"] });
    const mutes = new PodMutes(preferences, dir);
    // p9 is a plain terminal muted by hand: no agent, so nothing of this module's
    mutes.observe({ panes: [pane("w1:p2"), pane("w1:p9", { agent: null })], agents: [agent("w1:p2", "demo-eng")] });
    expect(preferences.get().muted_panes).toEqual(["w1:p9", "w1:p2"]);
    mutes.observe({ panes: [], agents: [] });
    // the mute made by hand is not this module's: it stays
    expect(preferences.get().muted_panes).toEqual(["w1:p9"]);
    const again = new PodMutes(new PreferenceStore(dir), dir);
    again.observe({ panes: [pane("w1:p2", { terminal_id: "term-new" })], agents: [agent("w1:p2", "rod-chief")] });
    expect(new PreferenceStore(dir).get().muted_panes).toEqual(["w1:p9"]);
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

describe("pod mutes across PCs", () => {
  it("mutes a remote PC's pod members under its own key, and each PC's snapshot keeps the other's mutes", () => {
    const dir = stateDir();
    const preferences = new PreferenceStore(dir);
    const mutes = new PodMutes(preferences, dir);
    mutes.observe({ panes: [pane("w1:p2")], agents: [agent("w1:p2", "demo-eng")] });
    mutes.observe({ panes: [pane("w1:p2"), pane("w1:p3")], agents: [agent("w1:p2", "rod-chief"), agent("w1:p3", "demo-design")] }, "pods");
    expect(preferences.get().muted_panes).toEqual(["w1:p2", "remote:pods:w1%3Ap3"]);
    // the Host's next snapshot does not forget the remote mute, nor the remote's the Host's
    mutes.observe({ panes: [pane("w1:p2")], agents: [agent("w1:p2", "demo-eng")] });
    mutes.observe({ panes: [pane("w1:p3")], agents: [agent("w1:p3", "demo-design")] }, "pods");
    expect(preferences.get().muted_panes).toEqual(["w1:p2", "remote:pods:w1%3Ap3"]);
  });

  it("lifts a remote pane's mute when that PC's pane is gone, and leaves the Host's alone", () => {
    const dir = stateDir();
    const preferences = new PreferenceStore(dir);
    const mutes = new PodMutes(preferences, dir);
    mutes.observe({ panes: [pane("w1:p2")], agents: [agent("w1:p2", "demo-eng")] });
    mutes.observe({ panes: [pane("w1:p3")], agents: [agent("w1:p3", "demo-design")] }, "pods");
    expect(preferences.get().muted_panes).toEqual(["w1:p2", "remote:pods:w1%3Ap3"]);
    mutes.observe({ panes: [], agents: [] }, "pods");
    expect(preferences.get().muted_panes).toEqual(["w1:p2"]);
  });

  it("reads the first file format, whose entries are this PC's", () => {
    const dir = stateDir();
    writeFileSync(join(dir, "rod-pod-mutes.json"), JSON.stringify({ muted: { "w1:p2": "term-w1:p2|claude|demo-eng" } }));
    const preferences = new PreferenceStore(dir);
    preferences.set({ settings: {}, muted_panes: [] });
    new PodMutes(preferences, dir).observe({ panes: [pane("w1:p2")], agents: [agent("w1:p2", "demo-eng")] });
    // the same agent was muted once already and unmuted since: it stays unmuted
    expect(preferences.get().muted_panes).toEqual([]);
  });
});

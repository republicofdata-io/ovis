import { describe, expect, it } from "bun:test";
import { alertingAgent, podRole, silentAgent } from "./rod-pods.ts";

describe("pod roles", () => {
  it("reads the role from a dispatch name, with or without its number", () => {
    expect(podRole("demo-pm", null)).toBe("pm");
    expect(podRole("demo-eng", null)).toBe("eng");
    expect(podRole("demo-eng-2", null)).toBe("eng");
    expect(podRole("big-demo-design-3389", null)).toBe("design");
  });

  it("takes the name's role over the pane label", () => {
    expect(podRole("demo-pm", "eng")).toBe("pm");
  });

  it("falls back to a pane label named after the role", () => {
    expect(podRole(null, "eng")).toBe("eng");
    expect(podRole(undefined, " Design ")).toBe("design");
    expect(podRole(null, "pm-2")).toBe("pm");
  });

  it("finds no role for agents in no pod", () => {
    expect(podRole(null, null)).toBeNull();
    expect(podRole("reviewer", "agent")).toBeNull();
    expect(podRole("engine", "files")).toBeNull();
    expect(podRole("demo-engineer", null)).toBeNull();
  });

});

describe("who alerts", () => {
  it("alerts for the chief of staff's pane only, by its herdr name or its pane label", () => {
    expect(alertingAgent("rod-chief", null)).toBe(true);
    expect(alertingAgent(null, " Rod-Chief ")).toBe(true);
    expect(alertingAgent("rod-desk", null)).toBe(false);
    expect(alertingAgent("demo-pm", "chief")).toBe(false);
  });

  it("keeps every other agent silent: product managers, the back office, pod members, agents in no pod, unnamed agents", () => {
    for (const name of ["demo-pm", "rod-desk", "demo-lead", "demo-eng-2", "demo-design", "reviewer", "solo"]) {
      expect(silentAgent(name, null)).toBe(true);
    }
    expect(silentAgent(null, null)).toBe(true);
    expect(silentAgent(null, "eng")).toBe(true);
    expect(silentAgent("rod-chief", null)).toBe(false);
  });

  it("takes another list of alerting names", () => {
    expect(silentAgent("demo-pm", null, ["demo-pm"])).toBe(false);
    expect(silentAgent("rod-chief", null, ["demo-pm"])).toBe(true);
  });
});

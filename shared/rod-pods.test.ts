import { describe, expect, it } from "bun:test";
import { podRole, silentPodRole } from "./rod-pods.ts";

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

  it("keeps only engineers and designers silent", () => {
    expect(silentPodRole("eng")).toBe(true);
    expect(silentPodRole("design")).toBe(true);
    expect(silentPodRole("pm")).toBe(false);
    expect(silentPodRole(null)).toBe(false);
  });
});

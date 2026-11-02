import { describe, expect, it } from "bun:test";
import { groupPods, podRole, silentPodRole } from "./rod-pods.ts";

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

describe("pod groups", () => {
  type Row = { id: string; tab: string | null; name?: string; label?: string };
  const read = (row: Row) => ({ pod: row.tab, role: podRole(row.name, row.label) });
  const ids = (rows: Row[]) => rows.map((row) => row.id);

  it("groups a tab's agents in role order, where its first row stood", () => {
    const rows: Row[] = [
      { id: "solo", tab: "t9", name: "reviewer" },
      { id: "design", tab: "t1", name: "demo-design" },
      { id: "hand", tab: "t1" },
      { id: "eng2", tab: "t1", name: "demo-eng-2" },
      { id: "pm", tab: "t1", label: "pm" },
      { id: "eng", tab: "t1", name: "demo-eng" },
      { id: "other-pm", tab: "t2", name: "other-pm" },
    ];
    const { pods, others } = groupPods(rows, read);
    expect(pods.map(({ key }) => key)).toEqual(["t1", "t2"]);
    expect(ids(pods[0]!.members)).toEqual(["pm", "eng2", "eng", "design", "hand"]);
    expect(ids(pods[1]!.members)).toEqual(["other-pm"]);
    expect(ids(others)).toEqual(["solo"]);
  });

  it("leaves rows with no tab or no pod role apart", () => {
    const { pods, others } = groupPods([{ id: "a", tab: null, name: "demo-pm" }, { id: "b", tab: "t3", label: "agent" }], read);
    expect(pods).toEqual([]);
    expect(ids(others)).toEqual(["a", "b"]);
  });
});

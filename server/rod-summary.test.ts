import { afterEach, describe, expect, it } from "bun:test";
import type { ConversationTurn, InteractivePrompt } from "../shared/protocol.ts";
import { currentText, forgetStatusesForTests, handleRodSummaryRequest, paneSummary, recordStatus } from "./rod-summary.ts";

const turn = (role: ConversationTurn["role"], ...texts: string[]): ConversationTurn => ({ role, ts: null, parts: texts.map((text) => ({ kind: "text", text })) });
const readers = (turns: ConversationTurn[], prompt: InteractivePrompt | null = null) => ({ prompt: async () => prompt, turns: async () => turns });

afterEach(() => forgetStatusesForTests());

describe("what the agent is doing now", () => {
  it("is the latest text of the current turn", () => {
    expect(currentText([turn("user", "Fix the login form"), turn("assistant", "Reading the form", "Running the tests now")])).toBe("Running the tests now");
  });

  it("is the prompt it works on before it wrote anything, never the previous turn's answer", () => {
    expect(currentText([turn("assistant", "Old answer"), turn("user", "Add a dark theme")])).toBe("Add a dark theme");
  });

  it("is nothing for an empty conversation", () => {
    expect(currentText([])).toBeNull();
  });
});

describe("the summary", () => {
  it("gives the status this server saw, since when, and the headline", async () => {
    recordStatus("w1:p1", "working", 1_000);
    recordStatus("w1:p1", "working", 5_000);
    const summary = await paneSummary("w1:p1", readers([turn("user", "go"), turn("assistant", "## Writing **tests**\nmore")]));
    expect(summary).toEqual({ status: "working", since: 1_000, headline: "Writing tests" });
  });

  it("quotes a waiting prompt's question while blocked", async () => {
    recordStatus("w1:p1", "blocked", 2_000);
    const prompt = { id: "p", agent: "claude", kind: "approval", title: "Bash command", question: "Run make deploy?", body: null, options: [], multi_select: false } as unknown as InteractivePrompt;
    expect((await paneSummary("w1:p1", readers([], prompt))).headline).toBe("Bash command: Run make deploy?");
  });

  it("answers with no status for a pane not seen, and no headline when reading fails or is slow", async () => {
    expect(await paneSummary("w1:p9", { prompt: async () => null, turns: async () => { throw new Error("no transcript"); } })).toEqual({ status: null, since: null, headline: null });
    expect((await paneSummary("w1:p9", { prompt: async () => null, turns: () => new Promise<never>(() => {}) }, 20)).headline).toBeNull();
  });
});

describe("GET /api/rod/summary", () => {
  it("answers a valid pane and refuses anything else", async () => {
    recordStatus("w1:p1", "done", 3_000);
    const ok = await handleRodSummaryRequest(new Request("http://x/api/rod/summary?pane_id=w1:p1"), new URL("http://x/api/rod/summary?pane_id=w1:p1"), () => readers([turn("assistant", "Ready for review")]));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: "done", since: 3_000, headline: "Ready for review" });
    const bad = await handleRodSummaryRequest(new Request("http://x/api/rod/summary?pane_id=../x y"), new URL("http://x/api/rod/summary?pane_id=../x%20y"), () => readers([]));
    expect(bad.status).toBe(400);
    const post = await handleRodSummaryRequest(new Request("http://x/api/rod/summary?pane_id=w1:p1", { method: "POST" }), new URL("http://x/api/rod/summary?pane_id=w1:p1"), () => readers([]));
    expect(post.status).toBe(405);
  });
});

describe("the summary of a remote PC's pane", () => {
  it("keeps each PC's status apart and answers for the PC asked about", async () => {
    recordStatus("w1:p1", "working", 1_000);
    recordStatus("w1:p1", "blocked", 2_000, "pods");
    expect((await paneSummary("w1:p1", readers([]))).status).toBe("working");
    expect(await paneSummary("w1:p1", readers([]), 2_500, "pods")).toEqual({ status: "blocked", since: 2_000, headline: null });
    let asked = null as string | null;
    const answer = await handleRodSummaryRequest(new Request("http://x/api/rod/summary?pane_id=w1:p1&machine=pods"), new URL("http://x/api/rod/summary?pane_id=w1:p1&machine=pods"), (machine) => { asked = machine; return readers([]); });
    expect(asked).toBe("pods");
    expect((await answer.json() as { status: string }).status).toBe("blocked");
    const bad = await handleRodSummaryRequest(new Request("http://x/"), new URL("http://x/api/rod/summary?pane_id=w1:p1&machine=../x"), () => readers([]));
    expect(bad.status).toBe(400);
  });
});

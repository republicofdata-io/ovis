import { describe, expect, it } from "bun:test";
import type { ConversationTurn, InteractivePrompt } from "../shared/protocol.ts";
import { alertText, headline, lastAssistantText, promptHeadline } from "./rod-alert-text.ts";
import { statusMessage } from "./push.ts";

const turn = (role: ConversationTurn["role"], ...parts: ConversationTurn["parts"]): ConversationTurn => ({ role, ts: null, parts });
const prompt = (title: string, question: string): InteractivePrompt =>
  ({ id: "p", agent: "claude", kind: "approval", title, question, body: null, options: [], multi_select: false }) as unknown as InteractivePrompt;

describe("alert headline", () => {
  it("takes the first line that says something, without Markdown marks", () => {
    expect(headline("\n## **demo-eng-2** needs permission to run `make deploy`\n\nDetails follow.")).toBe("demo-eng-2 needs permission to run make deploy");
    expect(headline("---\n- Tests pass, ready for review")).toBe("Tests pass, ready for review");
  });

  it("cuts a long line to the limit", () => {
    const line = headline("word ".repeat(80), 40)!;
    expect(line.length).toBeLessThanOrEqual(40);
    expect(line.endsWith("…")).toBe(true);
  });

  it("finds nothing in empty text", () => {
    expect(headline("")).toBeNull();
    expect(headline("\n  \n---\n")).toBeNull();
    expect(headline(null)).toBeNull();
  });
});

describe("the agent's last words", () => {
  it("prefers the final answer of the last assistant turn", () => {
    const turns = [
      turn("assistant", { kind: "text", text: "old answer" }),
      turn("user", { kind: "text", text: "go on" }),
      turn("assistant", { kind: "text", text: "Looking at the tests", phase: "commentary" }, { kind: "text", text: "Done: 3 files changed", phase: "final_answer" }, { kind: "text", text: "trailing note", phase: "commentary" }),
    ];
    expect(lastAssistantText(turns)).toBe("Done: 3 files changed");
  });

  it("falls back to the turn's last text, and skips a turn with none", () => {
    expect(lastAssistantText([turn("assistant", { kind: "text", text: "first" }, { kind: "text", text: "second" })])).toBe("second");
    expect(lastAssistantText([turn("assistant", { kind: "text", text: "earlier" }), turn("assistant", { kind: "thinking", text: "hmm" })])).toBe("earlier");
    expect(lastAssistantText([turn("user", { kind: "text", text: "hi" })])).toBeNull();
  });
});

describe("a prompt's headline", () => {
  it("joins the title and the question unless the question already says it", () => {
    expect(promptHeadline(prompt("Bash command", "Do you want to proceed?"))).toBe("Bash command: Do you want to proceed?");
    expect(promptHeadline(prompt("Allow", "Allow command git push?"))).toBe("Allow command git push?");
  });
});

describe("alert text", () => {
  const readers = {
    prompt: async () => prompt("Bash command", "Run make deploy?"),
    turns: async () => [turn("assistant", { kind: "text", text: "demo-eng-2 needs permission to run make deploy\nmore" })],
  };

  it("quotes the prompt while blocked and the last message when done", async () => {
    expect(await alertText("w1:p1", "blocked", readers)).toBe("Bash command: Run make deploy?");
    expect(await alertText("w1:p1", "done", readers)).toBe("demo-eng-2 needs permission to run make deploy");
    expect(await alertText("w1:p1", "idle", readers)).toBeUndefined();
  });

  it("leaves the usual text when reading fails, finds nothing, or is too slow", async () => {
    expect(await alertText("w1:p1", "blocked", { ...readers, prompt: async () => { throw new Error("herdr busy"); } })).toBeUndefined();
    expect(await alertText("w1:p1", "done", { ...readers, turns: async () => [] })).toBeUndefined();
    const never = { ...readers, turns: () => new Promise<never>(() => {}) };
    expect(await alertText("w1:p1", "done", never, 20)).toBeUndefined();
  });

  it("becomes the push body, and the usual text stays without one", () => {
    expect(statusMessage("w1:p1", "Pod demo", "done", "Tests pass").body).toBe("Tests pass");
    expect(statusMessage("w1:p1", "Pod demo", "done").body).toBe("work finished");
  });
});

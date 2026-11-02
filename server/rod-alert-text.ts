/**
 * RoD fork: an alert says what the agent needs, not only that it needs something. A finished turn
 * quotes the first line of the agent's last message (a pod's product manager opens with a one-line
 * headline, as its dispatch briefing asks); an agent waiting on a prompt quotes the prompt's question.
 * Anything that cannot be read in time leaves the alert's usual text (shared/notify-policy.ts).
 */
import type { AgentStatus, ConversationTurn, InteractivePrompt } from "../shared/protocol.ts";

/** about four lines of a phone notification */
export const ALERT_TEXT_LIMIT = 180;
/** an alert never waits longer than this for its text */
export const ALERT_TEXT_WAIT_MS = 2_500;

/** The first line that says something, without Markdown's marks, cut to the limit. */
export function headline(text: string | null | undefined, limit = ALERT_TEXT_LIMIT): string | null {
  if (!text) return null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s{0,3}(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/[*_`~]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (line === "" || /^[-=|:\s]+$/.test(line)) continue;
    return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line;
  }
  return null;
}

/** The agent's last words: the final answer of its last turn, else that turn's last text. */
export function lastAssistantText(turns: readonly ConversationTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (turn.role !== "assistant") continue;
    const texts = turn.parts.flatMap((part) => (part.kind === "text" && part.text.trim() !== "" ? [part] : []));
    const final = texts.filter((part) => part.phase === "final_answer").at(-1) ?? texts.at(-1);
    if (final) return final.text;
  }
  return null;
}

/** What a waiting prompt asks, as one line. */
export function promptHeadline(prompt: InteractivePrompt): string | null {
  const question = headline(prompt.question);
  const title = headline(prompt.title);
  if (question && title && !question.toLowerCase().includes(title.toLowerCase())) return headline(`${title}: ${question}`);
  return question ?? title;
}

export interface AlertTextReaders {
  /** the pane's waiting prompt, or null */
  prompt: (paneId: string) => Promise<InteractivePrompt | null>;
  /** the pane's latest turns */
  turns: (paneId: string) => Promise<readonly ConversationTurn[]>;
}

/** The text of a local pane's alert, or undefined for the usual one. */
export async function alertText(paneId: string, status: AgentStatus, readers: AlertTextReaders, waitMs = ALERT_TEXT_WAIT_MS): Promise<string | undefined> {
  const read = async (): Promise<string | null> => {
    if (status === "blocked") {
      const prompt = await readers.prompt(paneId);
      return prompt ? promptHeadline(prompt) : null;
    }
    if (status === "done") return headline(lastAssistantText(await readers.turns(paneId)));
    return null;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
  try {
    return (await Promise.race([read().catch(() => null), late])) ?? undefined;
  } finally {
    clearTimeout(timer);
  }
}

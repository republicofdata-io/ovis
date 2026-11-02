/**
 * RoD fork: the one line pinned above an agent's live terminal (src/components/RodSummary.tsx): its
 * status, since when, and what it is doing now. "Now" is the latest thing the agent wrote in its
 * current turn, or, before it wrote anything, the prompt it is working on; while it waits on a
 * prompt, that prompt's question. GET /api/rod/summary?pane_id=… answers for a local pane.
 */
import type { AgentStatus, ConversationTurn } from "../shared/protocol.ts";
import { badRequest, jsonResponse } from "./http.ts";
import { ALERT_TEXT_WAIT_MS, headline, promptHeadline, type AlertTextReaders } from "./rod-alert-text.ts";

export interface PaneSummary {
  status: AgentStatus | null;
  /** when the pane took that status, as this server saw it (ms since the epoch); null when not yet seen */
  since: number | null;
  /** what the agent is doing now, one line; null when nothing can be read */
  headline: string | null;
}

/** Each pane's status and since when, from the status events and snapshots this server reads. */
const clock = new Map<string, { status: AgentStatus; since: number }>();

export function recordStatus(paneId: string, status: AgentStatus, now = Date.now()): void {
  if (clock.get(paneId)?.status !== status) clock.set(paneId, { status, since: now });
}

export function forgetStatusesForTests(): void {
  clock.clear();
}

/** The latest text of the current turn, or, before the agent wrote any, the user's prompt that started it. */
export function currentText(turns: readonly ConversationTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    const text = turn.parts.filter((part) => part.kind === "text" && part.text.trim() !== "").at(-1);
    if (text && text.kind === "text") return text.text;
    if (turn.role === "user") return null; // a prompt with no text of its own (an image): nothing to say
  }
  return null;
}

export async function paneSummary(paneId: string, readers: AlertTextReaders, waitMs = ALERT_TEXT_WAIT_MS): Promise<PaneSummary> {
  const seen = clock.get(paneId);
  const status = seen?.status ?? null;
  const read = async (): Promise<string | null> => {
    if (status === "blocked") {
      const prompt = await readers.prompt(paneId);
      if (prompt) return promptHeadline(prompt);
    }
    return headline(currentText(await readers.turns(paneId)));
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
  try {
    const text = await Promise.race([read().catch(() => null), late]);
    return { status, since: seen?.since ?? null, headline: text };
  } finally {
    clearTimeout(timer);
  }
}

const PANE_ID = /^[A-Za-z0-9:_.-]{1,64}$/;

export async function handleRodSummaryRequest(request: Request, url: URL, readers: AlertTextReaders): Promise<Response> {
  if (request.method !== "GET") return jsonResponse({ error: { code: "method_not_allowed", message: "GET is required." } }, 405);
  const paneId = url.searchParams.get("pane_id") ?? "";
  if (!PANE_ID.test(paneId)) return badRequest("invalid_pane", "Send ?pane_id=<herdr pane id>.");
  return jsonResponse(await paneSummary(paneId, readers), 200, { "cache-control": "no-store" });
}

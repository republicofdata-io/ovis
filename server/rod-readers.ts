/**
 * RoD fork: the readers of a local pane's prompt and conversation that the alert text
 * (server/rod-alert-text.ts) and the summary line (server/rod-summary.ts) use.
 */
import { paneConversation } from "./conversation.ts";
import { readPrompt } from "./prompt.ts";
import type { AlertTextReaders } from "./rod-alert-text.ts";

export function localReaders(codexHome?: string, opencodeDb?: string): AlertTextReaders {
  return {
    prompt: async (paneId) => (await readPrompt(paneId, codexHome)).prompt,
    turns: async (paneId) => (await paneConversation(paneId, codexHome, { prompts: 1 }, undefined, opencodeDb)).turns,
  };
}

/**
 * RoD fork: the readers of a pane's prompt and conversation that the alert text
 * (server/rod-alert-text.ts) and the summary line (server/rod-summary.ts) use: this PC's own, or a
 * remote PC's through its bridge (the same GET /api/pane/prompt and /api/pane/conversation the
 * browser reaches through the machine proxy), so they work wherever this app runs.
 */
import { LOCAL_MACHINE } from "../shared/machines.ts";
import type { ConversationTurn, InteractivePrompt } from "../shared/protocol.ts";
import { paneConversation } from "./conversation.ts";
import { readPrompt } from "./prompt.ts";
import type { AlertTextReaders } from "./rod-alert-text.ts";

export function localReaders(codexHome?: string, opencodeDb?: string): AlertTextReaders {
  return {
    prompt: async (paneId) => (await readPrompt(paneId, codexHome)).prompt,
    turns: async (paneId) => (await paneConversation(paneId, codexHome, { prompts: 1 }, undefined, opencodeDb)).turns,
  };
}

type Endpoint = { url: string; token: string } | undefined;
const REMOTE_READ_MS = 2_500;

/** A remote PC's readers, through its bridge's URL and token (MachineManager.endpoint); none while it is away. */
export function remoteReaders(endpoint: () => Endpoint, fetcher: typeof fetch = fetch): AlertTextReaders {
  const get = async <T>(path: string): Promise<T> => {
    const bridge = endpoint();
    if (!bridge) throw new Error("PC not connected");
    const response = await fetcher(`${bridge.url}${path}`, { headers: { authorization: `Bearer ${bridge.token}` }, signal: AbortSignal.timeout(REMOTE_READ_MS) });
    if (!response.ok) throw new Error(`bridge answered ${response.status}`);
    return await response.json() as T;
  };
  return {
    prompt: async (paneId) => (await get<{ prompt?: InteractivePrompt | null }>(`/api/pane/prompt?pane_id=${encodeURIComponent(paneId)}`)).prompt ?? null,
    turns: async (paneId) => (await get<{ turns?: ConversationTurn[] }>(`/api/pane/conversation?pane_id=${encodeURIComponent(paneId)}&prompts=1`)).turns ?? [],
  };
}

/** The readers for a pane on `machineId`: this PC's own, or the remote PC's bridge. */
export function readersFor(machineId: string, options: { codexHome?: string; opencodeDb?: string; endpoint?: (id: string) => Endpoint }): AlertTextReaders {
  return machineId === LOCAL_MACHINE ? localReaders(options.codexHome, options.opencodeDb) : remoteReaders(() => options.endpoint?.(machineId));
}

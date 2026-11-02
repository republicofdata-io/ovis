/**
 * RoD fork: pod engineers and designers stay silent (shared/rod-pods.ts). Each herdr snapshot this
 * server reads is shown to `observe`; an agent whose pod role is silent is added once to the shared
 * mute list (server/preferences.ts `muted_panes`), which every alert channel already honours, and the
 * sidebar shows it muted. A mute undone by hand stays undone: each agent is muted once. When another
 * agent takes the pane, the mute this module made is lifted. Each PC's snapshots are shown with its
 * id (the Host's own, and each remote PC's through MachineManager), and touch only that PC's mutes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { LOCAL_MACHINE, paneStorageId } from "../shared/machines.ts";
import { podRole, silentPodRole } from "../shared/rod-pods.ts";
import type { PreferenceStore } from "./preferences.ts";
import { writeStateDocument } from "./state-document.ts";

type Snapshot = Pick<SessionSnapshot, "panes"> & { agents?: SessionSnapshot["agents"] };

export class PodMutes {
  /** the panes this module muted, by storage id, with their PC and the agent it muted in each */
  private readonly muted = new Map<string, { machine: string; agent: string }>();
  private readonly path: string;

  constructor(private readonly preferences: PreferenceStore, stateDir: string) {
    this.path = join(stateDir, "rod-pod-mutes.json");
    try {
      const held = JSON.parse(readFileSync(this.path, "utf8")) as { muted?: Record<string, unknown> };
      for (const [key, entry] of Object.entries(held.muted ?? {})) {
        // a bare agent is a Host pane, as the first version of this file wrote it
        if (typeof entry === "string") this.muted.set(key, { machine: LOCAL_MACHINE, agent: entry });
        else if (entry && typeof entry === "object" && typeof (entry as { machine?: unknown }).machine === "string" && typeof (entry as { agent?: unknown }).agent === "string") {
          this.muted.set(key, entry as { machine: string; agent: string });
        }
      }
    } catch {
      // none yet, or unreadable: start with none; the next change writes the file again
    }
  }

  observe(snapshot: Snapshot, machineId: string = LOCAL_MACHINE): void {
    const names = new Map((snapshot.agents ?? []).map((agent) => [agent.pane_id, agent.name ?? null]));
    const add: string[] = [];
    const lift: string[] = [];
    const present = new Set<string>();
    for (const pane of snapshot.panes) {
      const key = paneStorageId(machineId, pane.pane_id);
      present.add(key);
      const name = names.get(pane.pane_id) ?? null;
      // the agent in this pane: its terminal, kind and pod identity
      const agent = pane.agent ? `${pane.terminal_id ?? ""}|${pane.agent}|${name ?? pane.label ?? ""}` : null;
      const ours = this.muted.get(key)?.agent;
      if (ours !== undefined && ours !== agent) {
        this.muted.delete(key);
        lift.push(key);
      }
      if (agent !== null && silentPodRole(podRole(name, pane.label)) && this.muted.get(key)?.agent !== agent) {
        this.muted.set(key, { machine: machineId, agent });
        add.push(key);
      }
    }
    // a pane gone from this PC's herdr: forget it (the shared list is pruned of gone panes by its own owners)
    let forgot = false;
    for (const [key, entry] of [...this.muted]) if (entry.machine === machineId && !present.has(key)) { this.muted.delete(key); forgot = true; }
    if (add.length === 0 && lift.length === 0) {
      if (forgot) this.save();
      return;
    }
    const current = this.preferences.get().muted_panes ?? [];
    const next = [...current.filter((key) => !lift.includes(key) || add.includes(key))];
    for (const key of add) if (!next.includes(key)) next.push(key);
    try {
      if (next.length !== current.length || next.some((key, index) => key !== current[index])) {
        this.preferences.set({ settings: {}, muted_panes: next });
      }
    } catch (error) {
      console.error(`RoD pod mutes: cannot save the mute list (${error instanceof Error ? error.message : String(error)})`);
    }
    this.save();
  }

  private save(): void {
    try {
      writeStateDocument(this.path, `${JSON.stringify({ muted: Object.fromEntries(this.muted) }, null, 2)}\n`, false);
    } catch (error) {
      console.error(`RoD pod mutes: cannot write ${this.path} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
}

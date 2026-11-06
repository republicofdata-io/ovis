/**
 * RoD fork: pods of coding agents, as dispatch composes them in a herdr tab. A pod member's role is
 * read from its herdr agent name, `<pod>-<role>[-<n>]` (dispatch names them so), or else from its
 * pane's label when a layout names the pane after the role. See rod/README.md.
 */

export type PodRole = "pm" | "eng" | "design";

const NAMED = /-(pm|eng|design)(?:-\d+)?$/;
const LABELLED = /^(pm|eng|design)(?:-\d+)?$/;

/** The pod role of an agent, from its herdr name first, then its pane label; null for an agent in no pod. */
export function podRole(name: string | null | undefined, label: string | null | undefined): PodRole | null {
  const named = name ? NAMED.exec(name.trim().toLowerCase()) : null;
  if (named) return named[1] as PodRole;
  const labelled = label ? LABELLED.exec(label.trim().toLowerCase()) : null;
  return labelled ? (labelled[1] as PodRole) : null;
}

/** The herdr names of the agents whose lines are for Olivier: the chief of staff's own pane. */
export const DEFAULT_ALERTING_AGENTS: readonly string[] = ["rod-chief"];

/** Whether this agent is one Olivier wants alerts from, by its herdr name first, then its pane label. */
export function alertingAgent(name: string | null | undefined, label: string | null | undefined, alerting: readonly string[] = DEFAULT_ALERTING_AGENTS): boolean {
  const named = name?.trim().toLowerCase();
  const labelled = label?.trim().toLowerCase();
  return alerting.some((wanted) => wanted === named || wanted === labelled);
}

/**
 * Whether an agent stays silent: every agent that is not one of the alerting ones. Product managers,
 * the chief of staff's back office and every pod member report through the chief of staff, whose
 * pane is the one Olivier reads, so a new pane is quiet without a settings change. Until 2026-11-06
 * only pod engineers and designers were silent, and product managers alerted him directly.
 */
export function silentAgent(name: string | null | undefined, label: string | null | undefined, alerting: readonly string[] = DEFAULT_ALERTING_AGENTS): boolean {
  return !alertingAgent(name, label, alerting);
}

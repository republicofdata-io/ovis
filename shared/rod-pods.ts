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

/**
 * Whether a pod member stays silent: engineers and designers report to their product manager, who
 * alerts Olivier for them. The product manager and agents in no pod keep their alerts.
 */
export function silentPodRole(role: PodRole | null): boolean {
  return role === "eng" || role === "design";
}

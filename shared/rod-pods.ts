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

const ROLE_ORDER: Readonly<Record<PodRole, number>> = { pm: 0, eng: 1, design: 2 };

/**
 * Rows grouped by pod: a herdr tab with at least one member that has a pod role. All of that tab's
 * agents are its members (one started by hand has no role and comes last), ordered product
 * manager, engineers, designers, each group where its first row stood. Rows in no pod stay apart,
 * in their order.
 */
export function groupPods<T>(rows: readonly T[], read: (row: T) => { pod: string | null; role: PodRole | null }): { pods: { key: string; members: T[] }[]; others: T[] } {
  const seen = rows.map((row) => ({ row, ...read(row) }));
  const podKeys = new Set(seen.flatMap(({ pod, role }) => (pod !== null && role !== null ? [pod] : [])));
  const pods = new Map<string, { row: T; role: PodRole | null; index: number }[]>();
  const others: T[] = [];
  seen.forEach(({ row, pod, role }, index) => {
    if (pod === null || !podKeys.has(pod)) { others.push(row); return; }
    pods.set(pod, [...(pods.get(pod) ?? []), { row, role, index }]);
  });
  const rank = (role: PodRole | null): number => (role === null ? 3 : ROLE_ORDER[role]);
  return {
    pods: [...pods].map(([key, members]) => ({
      key,
      members: [...members].sort((a, b) => rank(a.role) - rank(b.role) || a.index - b.index).map(({ row }) => row),
    })),
    others,
  };
}

/**
 * RoD fork: the sidebar's Agents list grouped by pod (shared/rod-pods.ts groupPods). Each pod, a
 * herdr tab whose agents carry pod roles, gets a heading (its tab, then its workspace) and its
 * members in role order; agents in no pod follow under "Other agents". Rows are the list's own.
 */
import { Fragment, type ReactNode } from "react";
import { groupPods, podRole } from "../../shared/rod-pods.ts";
import type { AgentRow } from "../lib/agentRoster.ts";
import { useT } from "../lib/i18n.ts";
import { tabLabel } from "../lib/tabName.ts";

export function RodPodLists({ rows, item, machineCount }: { rows: readonly AgentRow[]; item: (row: AgentRow) => ReactNode; machineCount: number }) {
  const t = useT();
  const { pods, others } = groupPods(rows, ({ machine, entry }) => ({
    pod: entry.tab ? `${machine.id}|${entry.tab.tab_id}` : null,
    role: podRole(entry.agent?.name, entry.pane.label),
  }));
  const title = ({ machine, entry }: AgentRow): string => {
    const tabs = machine.snapshot?.tabs.filter((tab) => tab.workspace_id === entry.workspace.workspace_id) ?? [];
    const place = tabs.findIndex((tab) => tab.tab_id === entry.tab?.tab_id) + 1 || entry.tab?.number || 1;
    const name = entry.tab ? tabLabel(entry.tab, t, place) : entry.workspace.label;
    return [name, entry.workspace.label, machineCount > 1 ? machine.name : null].filter(Boolean).join(" · ");
  };
  return <>
    {pods.map(({ key, members }) => {
      const heading = title(members[0]!);
      return <Fragment key={key}>
        <p className="sidebar-pinned-label rod-pod-label" aria-hidden="true"><span>{heading}</span></p>
        <ul className="agent-list rod-pod" aria-label={heading}>{members.map(item)}</ul>
      </Fragment>;
    })}
    {others.length > 0 && <>
      {pods.length > 0 && <p className="sidebar-pinned-label rod-pod-label" aria-hidden="true"><span>{t("Other agents")}</span></p>}
      <ul className="agent-list" aria-label={pods.length > 0 ? t("Other agents") : undefined}>{others.map(item)}</ul>
    </>}
  </>;
}

/**
 * RoD fork: a fold over the workspaces when this Host is the sidebar's only PC. Ovis folds the
 * workspaces per PC from the PC's header, which it draws only beside another PC; alone, the Host
 * gets this heading instead, styled as the Agents heading and kept per device like the PC fold
 * (MachineSidebar.tsx, `ovis:pc-collapsed:<id>`).
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import { useT } from "../lib/i18n.ts";

export function RodWorkspacesToggle({ folded, count, onToggle }: { folded: boolean; count: number; onToggle: () => void }) {
  const t = useT();
  return <button type="button" className="agent-section-toggle sidebar-section-label rod-workspaces-toggle" aria-expanded={!folded} onClick={onToggle}>
    {folded ? <ChevronRight className="agent-section-caret" aria-hidden="true" /> : <ChevronDown className="agent-section-caret" aria-hidden="true" />}
    <span>{t("All workspaces")}</span>
    {folded && count > 0 && <span className="agent-section-count">{count}</span>}
  </button>;
}

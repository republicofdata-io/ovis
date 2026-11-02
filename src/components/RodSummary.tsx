/**
 * RoD fork: one line pinned over an agent's live terminal: its state, for how long, and what it is
 * doing now (server/rod-summary.ts). Read every 10 s and on each status change; a tap shows the whole
 * line. Local panes only. Follows Claude Code's own status line (state word, elapsed time, current
 * step), placed in the terminal's banner stack like the app's other notices.
 */
import { useEffect, useState } from "react";
import type { AgentStatus } from "../../shared/protocol.ts";
import { apiFetch } from "../lib/api-request-id.ts";
import { t } from "../lib/i18n.ts";
import { formatElapsed } from "../lib/omoTasks.ts";
import { knownStatus, STATUS_WORD } from "../lib/status.ts";
import "./RodSummary.css";

interface Summary {
  status: AgentStatus | null;
  since: number | null;
  headline: string | null;
}

const REFRESH_MS = 10_000;

export function RodSummary({ paneId, status }: { paneId: string; status?: AgentStatus }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = (): void => {
      apiFetch(`/api/rod/summary?pane_id=${encodeURIComponent(paneId)}`, { signal: controller.signal })
        .then((response) => (response.ok ? (response.json() as Promise<Summary>) : null))
        .then((next) => { if (next) { setSummary(next); setReadAt(Date.now()); } })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [paneId, status]);

  if (summary === null || (summary.headline === null && summary.since === null)) return null;
  const word = t(STATUS_WORD[knownStatus(summary.status ?? status)]);
  const elapsed = summary.since === null ? null : formatElapsed(Math.max(0, readAt - summary.since));
  return (
    <button type="button" className={`terminal-banner rod-summary${open ? " is-open" : ""}`} data-status={knownStatus(summary.status ?? status)}
      title={summary.headline ?? undefined} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span className="rod-summary-state">{elapsed === null ? word : `${word} · ${elapsed}`}</span>
      {summary.headline !== null && <span className="rod-summary-text">{summary.headline}</span>}
    </button>
  );
}

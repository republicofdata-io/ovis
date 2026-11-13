/**
 * RoD fork: a row over the chief of staff's composer that sends a pasted path from the PC this app
 * runs on to `~/incoming` on the chief's PC (server/rod-send-path.ts). It appears only when the
 * draft holds a path the server found on its own disk, and nothing leaves before the tap. Once the
 * copy is there, the pasted path in the draft becomes the copy's path on the chief's PC; the message
 * is still sent by hand. Follows the Claude app's attachment chip (a file named with its size, then
 * a progress line while it uploads), in the composer's own notice rows.
 */
import { FolderUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { baseName, pathCandidates, type SendPathJob, type SendPathOffer } from "../../shared/rod-send-path.ts";
import { apiFetch } from "../lib/api-request-id.ts";
import { t } from "../lib/i18n.ts";
import "./ComposerNotices.css";
import "./RodSendPath.css";

const CHECK_DELAY_MS = 400;
const POLL_MS = 1_000;

/** Sizes up to a screen recording's: GB with one decimal from 1 GB. */
export function sizeText(bytes: number): string {
  const gigabytes = bytes / 1024 ** 3;
  if (gigabytes >= 1) return `${(Math.round(gigabytes * 10) / 10).toFixed(1)} GB`;
  const megabytes = bytes / 1024 ** 2;
  if (megabytes >= 1) return `${Math.round(megabytes)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function post<T>(route: string, body: unknown): Promise<T | null> {
  const response = await apiFetch(`/api/rod/send-path/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => null) as (T & { error?: { message?: string } }) | null;
  if (!response.ok) throw new Error(json?.error?.message ?? t("The send could not start"));
  return json;
}

export function RodSendPath({ paneId, machineId, text, onSent }: { paneId: string; machineId: string; text: string; onSent: (pasted: string, remote: string) => void }) {
  const candidates = useMemo(() => pathCandidates(text), [text]);
  const key = candidates.map((item) => item.path).join("\n");
  const [offer, setOffer] = useState<SendPathOffer | null>(null);
  const [job, setJob] = useState<SendPathJob | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const sentFor = useRef<string | null>(null);

  // which pasted path is on the server's disk: asked once the draft stops changing
  useEffect(() => {
    if (key === "") { setOffer(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      post<{ offer: SendPathOffer | null }>("check", { machine: machineId, pane_id: paneId, paths: key.split("\n") })
        .then((answer) => { if (!controller.signal.aborted) setOffer(answer?.offer ?? null); })
        .catch(() => { if (!controller.signal.aborted) setOffer(null); });
    }, CHECK_DELAY_MS);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [key, machineId, paneId]);

  // a send under way: where it stands, every second, until it ends
  const jobId = job?.id ?? null;
  const running = job?.state === "preparing" || job?.state === "copying";
  useEffect(() => {
    if (jobId === null || !running) return;
    const timer = window.setInterval(() => {
      apiFetch(`/api/rod/send-path/job?id=${encodeURIComponent(jobId)}`)
        .then((response) => (response.ok ? (response.json() as Promise<{ job: SendPathJob }>) : null))
        .then((answer) => { if (answer) setJob(answer.job); })
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [jobId, running]);

  // arrived: the draft names the copy instead of the path on this computer
  useEffect(() => {
    if (job?.state !== "done" || job.remote === null || sentFor.current === job.id) return;
    sentFor.current = job.id;
    const pasted = candidates.find((item) => item.path === job.path);
    if (pasted) onSent(pasted.raw, job.remote);
  }, [candidates, job, onSent]);

  const send = (path: string): void => {
    setFailure(null);
    post<{ job: SendPathJob }>("send", { machine: machineId, pane_id: paneId, path })
      .then((answer) => { if (answer) setJob(answer.job); })
      .catch((error: unknown) => setFailure(error instanceof Error ? error.message : String(error)));
  };
  const stop = (id: string): void => {
    void post<{ job: SendPathJob }>("stop", { id }).then((answer) => { if (answer) setJob(answer.job); }).catch(() => undefined);
  };

  // what the row shows: the send in progress or just ended for a path still in the draft, else the offer
  const shownJob = job !== null && (running || job.state === "failed" || job.state === "stopped" ? candidates.some((item) => item.path === job.path) : job.state === "done" && job.remote !== null && text.includes(job.remote)) ? job : null;
  if (shownJob === null && offer === null) return null;

  let body: ReactNode;
  let action: ReactNode = null;
  let warning = false;
  if (shownJob !== null && (shownJob.state === "preparing" || shownJob.state === "copying")) {
    const percent = shownJob.total ? Math.min(100, Math.floor((shownJob.done / shownJob.total) * 100)) : null;
    body = (
      <>
        <span>{shownJob.total
          ? t("Sending {name} to the chief: {done} of {total}", { name: baseName(shownJob.path), done: sizeText(shownJob.done), total: sizeText(shownJob.total) })
          : t("Sending {name} to the chief…", { name: baseName(shownJob.path) })}</span>
        <span className="rod-send-path-bar" role="progressbar" aria-label={t("Sent so far")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
          <span style={{ width: `${percent ?? 0}%` }} />
        </span>
      </>
    );
    action = <button type="button" className="composer-notice-action" onClick={() => stop(shownJob.id)}>{t("Stop sending")}</button>;
  } else if (shownJob !== null && shownJob.state === "done") {
    body = t("Sent. Your message now points to the chief's copy: {path}", { path: shownJob.remote ?? "" });
  } else if (shownJob !== null) {
    warning = shownJob.state === "failed";
    body = shownJob.state === "stopped"
      ? t("Stopped. {name} can pick up where it left off.", { name: baseName(shownJob.path) })
      : t("{name} did not arrive: {reason}", { name: baseName(shownJob.path), reason: shownJob.error ?? "" });
    action = <button type="button" className="composer-notice-action" onClick={() => send(shownJob.path)}>{shownJob.state === "stopped" ? t("Send the rest") : t("Try again")}</button>;
  } else if (offer !== null) {
    warning = failure !== null;
    body = failure ?? (offer.bytes === null
      ? t("{name} is on your Mac. The chief can't read it until it is sent.", { name: baseName(offer.path) })
      : t("{name} ({size}) is on your Mac. The chief can't read it until it is sent.", { name: baseName(offer.path), size: sizeText(offer.bytes) }));
    action = <button type="button" className="composer-notice-action" title={t("Copies it to ~/incoming on {pc}", { pc: offer.to })} onClick={() => send(offer.path)}>{t("Send to the chief")}</button>;
  }

  return (
    <section className="composer-notices rod-send-path" aria-label={t("Send a file to the chief")}>
      <div className={`composer-notice${warning ? " is-warning" : ""}`} role="status">
        <span className="composer-notice-mark" aria-hidden="true"><FolderUp /></span>
        <span className="composer-notice-text rod-send-path-text">{body}</span>
        {action !== null && <span className="composer-notice-actions">{action}</span>}
      </div>
    </section>
  );
}

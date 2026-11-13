/**
 * RoD fork: send a pasted path from the PC this app runs on to the remote PC of the chief of staff's
 * pane, into `~/incoming` there (server/rod-send-path.ts, src/components/RodSendPath.tsx). What the
 * browser and the server share: which text in a draft is a path, and the name it gets on arrival.
 * See rod/README.md.
 */

/** The herdr name of the one agent whose composer offers to send a pasted path. */
export const CHIEF_AGENT = "rod-chief";

/** The folder under the remote account's home that receives what is sent. */
export const INCOMING_DIR = "incoming";

const MAX_PATH = 1024;
const MAX_CANDIDATES = 4;
const MAX_NAME = 80;

/** A path found in a draft: `raw` is its exact text there (quotes left out), `path` what it names. */
export interface PathCandidate {
  raw: string;
  path: string;
}

/** What the browser asks about a draft (POST /api/rod/send-path/check). */
export interface SendPathCheck {
  machine: string;
  pane_id: string;
  paths: string[];
}

/** A path the server found on its own disk and offers to send. */
export interface SendPathOffer {
  path: string;
  name: string;
  kind: "file" | "folder";
  /** total size of the regular files; null when the folder was too big to measure quickly */
  bytes: number | null;
  /** the remote PC's name, for the button */
  to: string;
}

export type SendPathState = "preparing" | "copying" | "done" | "failed" | "stopped";

/** Where one send stands (GET /api/rod/send-path/job?id=). */
export interface SendPathJob {
  id: string;
  path: string;
  name: string;
  state: SendPathState;
  /** bytes sent so far in this run, and the total to send */
  done: number;
  total: number | null;
  /** the copy's absolute path on the remote PC, once known */
  remote: string | null;
  error: string | null;
}

/** `\ ` and the like, as a terminal or Finder's drag escapes a path, read back as their characters. */
function unescape(text: string): string {
  return text.replace(/\\(.)/g, "$1");
}

/** Whether text can be an absolute path worth asking the server about. */
export function plausiblePath(path: string): boolean {
  if (path.length > MAX_PATH || /[\0\r\n]/.test(path)) return false;
  // `~/…`, or at least two levels from the root: a slash command (`/compact`) or a top folder is not a file to send
  return /^~\/[^/]/.test(path) || /^\/[^/]+\/[^/]/.test(path);
}

/**
 * The paths a draft may hold: a whole line that is an absolute path (`/…` or `~/…`, spaces escaped
 * with `\ ` or not), or a quoted one inside a sentence (`'…'`, `"…"`, `` `…` ``). Only candidates: the
 * server says which exist. At most a few, first found first.
 */
export function pathCandidates(text: string): PathCandidate[] {
  const found: PathCandidate[] = [];
  const add = (raw: string, path: string): void => {
    if (found.length >= MAX_CANDIDATES || !plausiblePath(path) || found.some((item) => item.path === path)) return;
    found.push({ raw, path });
  };
  for (const match of text.matchAll(/(['"`])((?:\/|~\/)[^'"`\n]*)\1/g)) add(match[2]!, match[2]!);
  for (const line of text.split("\n")) {
    const raw = line.trim();
    if (raw === "" || /^['"`]/.test(raw)) continue;
    add(raw, unescape(raw));
  }
  return found;
}

/** The last part of a path, without the slash a folder may end with. */
export function baseName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? "";
}

/**
 * The name a sent file or folder gets in `~/incoming`: the day it was sent, then its own name with
 * every character other than letters, digits, `.`, `_` and `-` made a `-`. It can never be `..`, start
 * with `-` or `.`, or leave the folder.
 */
export function incomingName(path: string, day: Date): string {
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const own = baseName(path)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, MAX_NAME)
    .replace(/[-.]+$/, "");
  return own === "" ? `${date}-sent` : `${date}-${own}`;
}

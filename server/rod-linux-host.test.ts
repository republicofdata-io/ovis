/**
 * RoD fork: Ovis on an always-on Linux machine that other users share (rod/linux-host.sh). The
 * server runs as its owner, on loopback, behind `tailscale serve`, with OVIS_TOKEN set. Any other
 * user's process on that machine can reach the loopback port, reach the node's own serve address
 * (which states the owner's login for an untagged node), and write any header it likes. The token
 * is what turns all of them away: these cases keep it first in the access check, before the
 * Tailscale login, the declared serve-only ingress and the local connection, so an official
 * release that reorders `decideAccess` cannot let them in again unnoticed.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./index.ts";
import { TailnetIdentitySource } from "./tailscale.ts";

const TOKEN = "a-token-long-enough-to-be-a-real-one-0123456789";
const OWNER = "owner@example.com";
const NODE = "demo-server.example.ts.net";
// what `tailscale status --json` says there: one login owns every node, this one untagged
const STATUS = JSON.stringify({
  BackendState: "Running",
  Self: { DNSName: `${NODE}.`, UserID: 7, TailscaleIPs: ["100.101.102.103"] },
  Peer: { phone: { DNSName: "demo-phone.example.ts.net.", UserID: 7 } },
  User: { "7": { LoginName: OWNER } },
});

const PANE = "w1:p1";
const serve = { "tailscale-user-login": OWNER, "x-forwarded-for": "100.64.0.9", "x-forwarded-proto": "https", host: NODE };
const cli = { "content-type": "application/json", "x-herdr-machine": "1" };
const line = JSON.stringify({ pane_id: PANE, text: "echo refused\n" });

/** Every way in that a process of another user on the machine has, without the token. */
const tries: Array<[string, string, RequestInit]> = [
  ["a plain local request", "/api/session", {}],
  ["a line sent from this machine", "/api/pane/input", { method: "POST", headers: cli, body: line }],
  ["keys sent from this machine", "/api/pane/keys", { method: "POST", headers: cli, body: JSON.stringify({ pane_id: PANE, keys: ["Enter"] }) }],
  ["a prompt answered from this machine", "/api/pane/prompt/answer", { method: "POST", headers: cli, body: JSON.stringify({ pane_id: PANE, answer: 1 }) }],
  ["a pairing started from this machine", "/api/devices/pair/start", { method: "POST", headers: cli, body: "{}" }],
  ["the paired devices", "/api/devices", {}],
  ["the live terminal stream", "/ws", { headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } }],
  ["the owner's Tailscale login, as serve states it or as forged", "/api/session", { headers: serve }],
  ["a line under the owner's Tailscale login", "/api/pane/input", { method: "POST", headers: { ...cli, ...serve }, body: line }],
  ["a serve request with no login, at the node's own name", "/api/session", { headers: { "x-forwarded-for": "100.64.0.9", "x-forwarded-proto": "https", host: NODE } }],
  ["a wrong token", "/api/session", { headers: { authorization: "Bearer not-the-token" } }],
];

describe("an always-on Linux machine shared with other users: OVIS_TOKEN turns them away", () => {
  const state = mkdtempSync(join(tmpdir(), "rod-linux-host-"));
  const tailnet = new TailnetIdentitySource(async () => STATUS);
  // as rod/linux-host.sh sets it up, and the same with the Mac's OVIS_TAILSCALE_SERVE_ONLY copied over by mistake
  const servers = [
    { name: "as set up", app: createServer({ port: 0, hostname: "127.0.0.1", token: TOKEN, stateDir: join(state, "a"), tailscaleOwner: OWNER, tailscaleServeOnly: false, tailnet }) },
    { name: "with serve declared the only ingress", app: createServer({ port: 0, hostname: "127.0.0.1", token: TOKEN, stateDir: join(state, "b"), tailscaleOwner: OWNER, tailscaleServeOnly: true, tailnet }) },
  ];
  beforeAll(() => { for (const { app } of servers) expect(app.port).toBeGreaterThan(0); });
  afterAll(() => {
    for (const { app } of servers) app.stop();
    rmSync(state, { recursive: true, force: true });
  });

  for (const { name, app } of servers) {
    for (const [what, path, init] of tries) {
      it(`${name}: refuses ${what}`, async () => {
        const response = await fetch(`http://127.0.0.1:${app.port}${path}`, init);
        expect(response.status).toBe(401);
        await response.body?.cancel();
      });
    }

    it(`${name}: says it asks for a token, and lets the token in`, async () => {
      const health = await (await fetch(`http://127.0.0.1:${app.port}/api/health?scope=bridge`)).json() as { auth: { required: boolean; authenticated: boolean } };
      expect(health.auth).toMatchObject({ required: true, authenticated: false });
      const held = await fetch(`http://127.0.0.1:${app.port}/api/health?scope=bridge`, { headers: { authorization: `Bearer ${TOKEN}` } });
      expect(((await held.json()) as { auth: { authenticated: boolean } }).auth.authenticated).toBe(true);
      // past the access check, the request reaches herdr: the unit tests' herdr is a socket that does not exist
      const session = await fetch(`http://127.0.0.1:${app.port}/api/session`, { headers: { authorization: `Bearer ${TOKEN}` } });
      expect(session.status).not.toBe(401);
      await session.body?.cancel();
    });
  }

  // the control: without the token the same machine lets these tries in, so the 401s above are the
  // token's doing, and the forged headers are the shape the server reads as Tailscale's
  it("without a token, lets a plain local request and the owner's forged login in", async () => {
    const open = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: join(state, "open"), tailscaleOwner: OWNER, tailscaleServeOnly: false, tailnet });
    try {
      const at = async (headers: Record<string, string>) => ((await (await fetch(`http://127.0.0.1:${open.port}/api/health?scope=bridge`, { headers })).json()) as { auth: { authenticated: boolean; via?: string } }).auth;
      expect(await at({})).toMatchObject({ authenticated: true, via: "local" });
      expect(await at(serve)).toMatchObject({ authenticated: true, via: "tailscale" });
      for (const headers of [{}, serve]) {
        const response = await fetch(`http://127.0.0.1:${open.port}/api/pane/input`, { method: "POST", headers: { ...cli, ...headers }, body: line });
        expect(response.status).not.toBe(401);
        await response.body?.cancel();
      }
    } finally {
      open.stop();
    }
  });
});

import { describe, expect, it } from "bun:test";
import { readersFor, remoteReaders } from "./rod-readers.ts";

describe("remote readers", () => {
  it("read a remote pane's prompt and conversation from its bridge, with the bridge's token", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify(url.includes("/api/pane/prompt") ? { prompt: { title: "Bash", question: "Run it?" } } : { turns: [{ role: "assistant", ts: null, parts: [{ kind: "text", text: "Done" }] }] }));
    }) as typeof fetch;
    const readers = remoteReaders(() => ({ url: "http://127.0.0.1:4000", token: "demo-token" }), fetcher);
    expect((await readers.prompt("w1:p2"))?.question).toBe("Run it?");
    expect((await readers.turns("w1:p2"))[0]?.role).toBe("assistant");
    expect(seen).toEqual([
      { url: "http://127.0.0.1:4000/api/pane/prompt?pane_id=w1%3Ap2", auth: "Bearer demo-token" },
      { url: "http://127.0.0.1:4000/api/pane/conversation?pane_id=w1%3Ap2&prompts=1", auth: "Bearer demo-token" },
    ]);
  });

  it("fail while the PC is away or its bridge refuses", async () => {
    expect(remoteReaders(() => undefined).turns("w1:p2")).rejects.toThrow("PC not connected");
    const refusing = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    expect(remoteReaders(() => ({ url: "http://127.0.0.1:4000", token: "t" }), refusing).prompt("w1:p2")).rejects.toThrow("401");
  });

  it("pick a remote PC's bridge only for a remote PC", async () => {
    let asked = null as string | null;
    await readersFor("pods", { endpoint: (id) => { asked = id; return undefined; } }).turns("w1:p2").catch(() => {});
    expect(asked).toBe("pods");
  });
});

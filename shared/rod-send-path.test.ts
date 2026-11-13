import { describe, expect, it } from "bun:test";
import { incomingName, pathCandidates } from "./rod-send-path.ts";

const day = new Date(2026, 10, 12, 9, 30);

describe("a path in a draft", () => {
  it("is a line that is a path, as pasted from Finder", () => {
    expect(pathCandidates("/Volumes/DEMO/Screen Recordings/demo-walkthrough")).toEqual([
      { raw: "/Volumes/DEMO/Screen Recordings/demo-walkthrough", path: "/Volumes/DEMO/Screen Recordings/demo-walkthrough" },
    ]);
  });

  it("reads a terminal's escaped spaces back, and keeps the text as typed to replace it", () => {
    expect(pathCandidates("look at this\n/Volumes/DEMO/Screen\\ Recordings/take.mov")).toEqual([
      { raw: "/Volumes/DEMO/Screen\\ Recordings/take.mov", path: "/Volumes/DEMO/Screen Recordings/take.mov" },
    ]);
  });

  it("is a quoted path inside a sentence, the quotes left out", () => {
    expect(pathCandidates("Do you have access to this folder? '/Volumes/DEMO/Screen Recordings/demo-walkthrough'")).toEqual([
      { raw: "/Volumes/DEMO/Screen Recordings/demo-walkthrough", path: "/Volumes/DEMO/Screen Recordings/demo-walkthrough" },
    ]);
  });

  it("can start at the home folder", () => {
    expect(pathCandidates("~/Desktop/notes.md").map((item) => item.path)).toEqual(["~/Desktop/notes.md"]);
  });

  it("is never a slash command, a top folder, a URL or a path in the middle of a sentence", () => {
    expect(pathCandidates("/compact")).toEqual([]);
    expect(pathCandidates("/Volumes")).toEqual([]);
    expect(pathCandidates("https://example.com/a/b")).toEqual([]);
    expect(pathCandidates("//server/share/file")).toEqual([]);
    expect(pathCandidates("please read /Users/demo/notes.md now")).toEqual([]);
    expect(pathCandidates("relative/path/file.txt")).toEqual([]);
  });

  it("is offered once, and only a few per draft", () => {
    const text = ["/a/1", "/a/1", "/a/2", "/a/3", "/a/4", "/a/5"].join("\n");
    expect(pathCandidates(text).map((item) => item.path)).toEqual(["/a/1", "/a/2", "/a/3", "/a/4"]);
  });
});

describe("the name in ~/incoming", () => {
  it("is the day, then the file or folder's own name", () => {
    expect(incomingName("/Volumes/DEMO/Screen Recordings/demo-walkthrough", day)).toBe("2026-11-12-demo-walkthrough");
    expect(incomingName("/Users/demo/Movies/demo take 2.mov/", day)).toBe("2026-11-12-demo-take-2.mov");
  });

  it("keeps only letters, digits, dots, dashes and underscores, and never leaves the folder", () => {
    const hostile = ["/tmp/x/..", "/tmp/x/-rf", "/tmp/x/$(touch pwned)", "/tmp/x/a'b\"c `d`", "/tmp/x/..hidden", "/tmp/x/Résumé.pdf", "/"];
    const names = hostile.map((path) => incomingName(path, day));
    expect(names).toEqual(["2026-11-12-sent", "2026-11-12-rf", "2026-11-12-touch-pwned", "2026-11-12-a-b-c-d", "2026-11-12-hidden", "2026-11-12-Resume.pdf", "2026-11-12-sent"]);
    for (const name of names) {
      expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(name.includes("..")).toBe(false);
    }
  });
});

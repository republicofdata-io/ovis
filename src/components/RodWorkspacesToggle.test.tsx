import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsProvider } from "../lib/settings.ts";
import { RodWorkspacesToggle } from "./RodWorkspacesToggle.tsx";

function render(folded: boolean, count: number): string {
  const saved = Object.getOwnPropertyDescriptor(navigator, "languages");
  Object.defineProperty(navigator, "languages", { configurable: true, value: ["en"] });
  try {
    return renderToStaticMarkup(<SettingsProvider><RodWorkspacesToggle folded={folded} count={count} onToggle={() => {}} /></SettingsProvider>);
  } finally {
    if (saved) Object.defineProperty(navigator, "languages", saved);
    else delete (navigator as { languages?: unknown }).languages;
  }
}

describe("the workspaces fold", () => {
  it("says it is open, without a count", () => {
    const html = render(false, 5);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("All workspaces");
    expect(html).not.toContain("agent-section-count");
  });

  it("says it is folded, with how many workspaces it holds", () => {
    const html = render(true, 5);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('<span class="agent-section-count">5</span>');
  });
});

import { describe, expect, it } from "vitest";
import { previewDocument } from "./previewDocument";

describe("previewDocument", () => {
  it("leaves the response alone when external resources are off", () => {
    const html = "<html><head></head><body></body></html>";
    expect(previewDocument(html, "https://example.com/a/b", false)).toBe(html);
  });

  it("leaves the response alone when there is no URL to point at", () => {
    const html = "<html><head></head><body></body></html>";
    expect(previewDocument(html, "", true)).toBe(html);
  });

  it("puts the base inside an existing head", () => {
    const out = previewDocument("<html><head><title>t</title></head></html>", "https://x/a", true);
    expect(out).toBe('<html><head><base href="https://x/a"><title>t</title></head></html>');
  });

  it("keeps the head's own attributes", () => {
    const out = previewDocument('<head data-x="1">', "https://x/a", true);
    expect(out).toBe('<head data-x="1"><base href="https://x/a">');
  });

  it("falls back to the html tag when the response has no head", () => {
    const out = previewDocument("<html><body><img src='p.png'></body></html>", "https://x/a", true);
    expect(out).toBe('<html><base href="https://x/a"><body><img src=\'p.png\'></body></html>');
  });

  it("prepends when the response has neither", () => {
    const out = previewDocument("<img src='p.png'>", "https://x/a", true);
    expect(out).toBe('<base href="https://x/a"><img src=\'p.png\'>');
  });

  it("escapes what would end the attribute or start a character reference", () => {
    const out = previewDocument("<head>", 'https://x/?q="1"&amp=2', true);
    expect(out).toBe('<head><base href="https://x/?q=&quot;1&quot;&amp;amp=2">');
  });

  it("adds one base, not one per matching tag", () => {
    const out = previewDocument("<head></head><head></head>", "https://x/a", true);
    expect(out.match(/<base /g)).toHaveLength(1);
  });
});

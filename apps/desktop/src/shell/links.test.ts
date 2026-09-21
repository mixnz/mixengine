import { describe, expect, it } from "vitest";
import { privacyPolicyUrl, selfHostingUrl } from "./links";

describe("links", () => {
  it("opens the self-hosting page in the app's language", () => {
    expect(selfHostingUrl("en")).toBe("https://mixnz.github.io/mixlab/en/self-hosting/");
    expect(selfHostingUrl("vi")).toBe("https://mixnz.github.io/mixlab/vi/self-hosting/");
  });

  it("keeps both pages on the same handbook", () => {
    expect(new URL(selfHostingUrl("en")).origin).toBe(new URL(privacyPolicyUrl("en")).origin);
  });
});

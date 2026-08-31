import { describe, expect, it } from "vitest";

import { assertPublicUrl, isBlockedUrl } from "@/lib/ssrf";

describe("SSRF guard", () => {
  it("allows public HTTP(S) URLs", () => {
    expect(isBlockedUrl("https://example.com/page")).toBeNull();
    expect(() => assertPublicUrl("https://example.com/page")).not.toThrow();
  });

  it.each([
    "http://localhost:8123",
    "http://127.0.0.1:9222",
    "http://192.168.1.10",
    "http://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
  ])("blocks %s", (url) => {
    expect(isBlockedUrl(url)).not.toBeNull();
    expect(() => assertPublicUrl(url)).toThrow("Blocked URL");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("chat renderer content security policy", () => {
  it("allows local data images without relaxing script sources", () => {
    const html = readFileSync(new URL("./chat.html", import.meta.url), "utf8");

    expect(html).toContain("img-src 'self' data:");
    expect(html).toContain("script-src 'self'");
    expect(html).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});

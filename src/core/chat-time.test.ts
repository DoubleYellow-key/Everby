import { describe, expect, it } from "vitest";
import { formatChatTime } from "./chat-time";

describe("chat message time", () => {
  it("shows only the time for messages sent today", () => {
    const now = new Date(2026, 8, 2, 18, 30).getTime();
    const sentAt = new Date(2026, 8, 2, 9, 5).getTime();

    expect(formatChatTime(sentAt, now)).toBe("09:05");
  });

  it("labels messages sent yesterday", () => {
    const now = new Date(2026, 8, 2, 0, 10).getTime();
    const sentAt = new Date(2026, 8, 1, 23, 50).getTime();

    expect(formatChatTime(sentAt, now)).toBe("昨天 23:50");
  });

  it("includes the date for older messages and the year when needed", () => {
    const now = new Date(2026, 8, 2, 18, 30).getTime();

    expect(formatChatTime(new Date(2026, 7, 28, 7, 6).getTime(), now)).toBe("8月28日 07:06");
    expect(formatChatTime(new Date(2025, 11, 31, 22, 8).getTime(), now)).toBe("2025年12月31日 22:08");
  });
});

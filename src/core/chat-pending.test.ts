import { describe, expect, it } from "vitest";
import { isPendingChatPersisted, type PendingChatMessage } from "./chat-pending";

const pending: PendingChatMessage = {
  content: "图里有什么？", attachments: [{
    id: "image-1", name: "image.jpg", mimeType: "image/jpeg",
    dataUrl: "data:image/jpeg;base64,YQ==", size: 1
  }], sentAt: 2_000, failed: false
};

describe("optimistic chat message reconciliation", () => {
  it("keeps the optimistic message until a matching newer user turn is persisted", () => {
    expect(isPendingChatPersisted([{ id: "old", role: "user", content: "图里有什么？", attachments: pending.attachments, createdAt: 1_000 }], pending)).toBe(false);
    expect(isPendingChatPersisted([{ id: "new", role: "user", content: "图里有什么？", attachments: pending.attachments, createdAt: 2_100 }], pending)).toBe(true);
  });

  it("does not reconcile a different attachment", () => {
    expect(isPendingChatPersisted([{ id: "new", role: "user", content: "图里有什么？", attachments: [{ ...pending.attachments[0], id: "image-2" }], createdAt: 2_100 }], pending)).toBe(false);
  });
});

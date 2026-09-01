import type { ChatImageAttachment, ChatMessage } from "../shared/contracts";

export interface PendingChatMessage {
  content: string;
  attachments: ChatImageAttachment[];
  sentAt: number;
  failed: boolean;
}

export function isPendingChatPersisted(messages: ChatMessage[], pending: PendingChatMessage): boolean {
  return messages.some((message) =>
    message.role === "user"
    && message.createdAt >= pending.sentAt
    && message.content === pending.content
    && message.attachments.length === pending.attachments.length
    && message.attachments.every((attachment, index) => attachment.id === pending.attachments[index]?.id)
  );
}

import base64
import binascii
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AgentCapabilities(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    streaming: bool = False
    tool_calling: bool = Field(default=False, alias="toolCalling")
    embedding: bool = False
    vision: bool = False


class ChatImageAttachment(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9-]+$")
    name: str = Field(min_length=1, max_length=160)
    mime_type: Literal["image/jpeg", "image/png", "image/webp"] = Field(alias="mimeType")
    data_url: str = Field(alias="dataUrl", min_length=32, max_length=3_000_000)
    size: int = Field(gt=0, le=2_000_000)

    @model_validator(mode="after")
    def validate_data_url(self) -> "ChatImageAttachment":
        prefix = f"data:{self.mime_type};base64,"
        if not self.data_url.startswith(prefix):
            raise ValueError("图片数据格式无效")
        try:
            decoded = base64.b64decode(self.data_url[len(prefix):], validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("图片数据格式无效") from error
        if len(decoded) != self.size:
            raise ValueError("图片数据长度不一致")
        return self


class TodoItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    title: str
    notes: str
    due_at: int | None = Field(alias="dueAt")
    remind_at: int | None = Field(alias="remindAt")
    repeat: Literal["none", "daily"]
    source: Literal["manual", "chat"]
    created_at: int = Field(alias="createdAt")
    updated_at: int = Field(alias="updatedAt")
    completed_at: int | None = Field(alias="completedAt")
    last_reminded_at: int | None = Field(alias="lastRemindedAt")


class MemoryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    type: Literal["preference", "identity", "goal", "project", "habit", "relationship", "commitment"]
    content: str
    source_message_id: str | None = Field(alias="sourceMessageId")
    confidence: float
    embedding_model: str | None = Field(alias="embeddingModel")
    created_at: int = Field(alias="createdAt")
    updated_at: int = Field(alias="updatedAt")
    accessed_at: int = Field(alias="accessedAt")
    indexed: bool

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AgentCapabilities(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    streaming: bool = False
    tool_calling: bool = Field(default=False, alias="toolCalling")
    embedding: bool = False


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

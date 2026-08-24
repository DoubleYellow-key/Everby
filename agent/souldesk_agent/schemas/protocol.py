from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

PROTOCOL_VERSION = 2


class RpcRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str = Field(min_length=1, max_length=100)
    protocol_version: Literal[2] = Field(alias="protocolVersion")
    method: str = Field(min_length=1, max_length=100)
    params: dict[str, Any] = Field(default_factory=dict)


class RpcError(BaseModel):
    code: str
    message: str
    retryable: bool = False


class RpcEvent(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    protocol_version: Literal[2] = Field(default=2, alias="protocolVersion")
    type: str
    request_id: str | None = Field(default=None, alias="requestId")
    data: dict[str, Any] = Field(default_factory=dict)


class RpcResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    protocol_version: Literal[2] = Field(default=2, alias="protocolVersion")
    id: str
    result: Any = None
    error: RpcError | None = None

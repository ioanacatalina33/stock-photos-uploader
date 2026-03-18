from __future__ import annotations

from enum import Enum
from pydantic import BaseModel, Field


class ProcessingStatus(str, Enum):
    PENDING = "pending"
    ANALYZING = "analyzing"
    READY = "ready"
    UPLOADING = "uploading"
    UPLOADED = "uploaded"
    ERROR = "error"


class PhotoMetadata(BaseModel):
    title: str = Field("", max_length=200)
    description: str = Field("", max_length=2048)
    keywords: list[str] = Field(default_factory=list)
    adobe_category: int | None = Field(None, ge=1, le=21)
    shutterstock_category_1: str = ""
    shutterstock_category_2: str = ""
    editorial: bool = False
    mature_content: bool = False
    releases: list[str] = Field(default_factory=list)


class PhotoItem(BaseModel):
    id: str
    filename: str
    original_filename: str
    filepath: str
    thumbnail_url: str
    width: int = 0
    height: int = 0
    file_size: int = 0
    status: ProcessingStatus = ProcessingStatus.PENDING
    metadata: PhotoMetadata = Field(default_factory=PhotoMetadata)
    error_message: str = ""


class BatchStatus(BaseModel):
    total: int = 0
    pending: int = 0
    analyzing: int = 0
    ready: int = 0
    uploading: int = 0
    uploaded: int = 0
    errors: int = 0


class PlatformCredentials(BaseModel):
    host: str
    username: str
    password: str


class AppSettings(BaseModel):
    openai_api_key: str = ""
    adobe_stock: PlatformCredentials | None = None
    shutterstock: PlatformCredentials | None = None


class BatchContext(BaseModel):
    location: str = ""
    common_keywords: list[str] = Field(default_factory=list)
    photo_styles: list[str] = Field(
        default_factory=lambda: ["Travel", "Landscape", "Nature", "Sunsets/Sunrises"]
    )


class MetadataUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    keywords: list[str] | None = None
    adobe_category: int | None = None
    shutterstock_category_1: str | None = None
    shutterstock_category_2: str | None = None
    editorial: bool | None = None
    mature_content: bool | None = None


class UploadRequest(BaseModel):
    photo_ids: list[str]
    platform: str = Field(..., pattern="^(adobe_stock|shutterstock|both)$")


class UploadProgress(BaseModel):
    photo_id: str
    filename: str
    platform: str
    status: str
    message: str = ""


class APIResponse(BaseModel):
    success: bool
    message: str = ""
    data: dict | list | None = None

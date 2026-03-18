from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter

from fastapi import Body

from app.config import load_settings
from app.models.schemas import (
    APIResponse,
    BatchContext,
    MetadataUpdateRequest,
    ProcessingStatus,
)
from app.routers.photos import photo_store
from app.services.ai_analyzer import analyze_photo
from app.services.metadata_writer import write_metadata

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/metadata", tags=["metadata"])


@router.post("/analyze/{photo_id}")
async def analyze_single(
    photo_id: str,
    context: BatchContext | None = Body(None),
) -> APIResponse:
    """Analyze a single photo with AI and generate metadata."""
    item = photo_store.get(photo_id)
    if not item:
        return APIResponse(success=False, message="Photo not found")

    settings = load_settings()
    if not settings.openai_api_key:
        return APIResponse(success=False, message="OpenAI API key not configured")

    item.status = ProcessingStatus.ANALYZING
    try:
        metadata = await analyze_photo(
            item.filepath, settings.openai_api_key, context
        )
        item.metadata = metadata
        item.status = ProcessingStatus.READY
        return APIResponse(
            success=True,
            message="Analysis complete",
            data=item.model_dump(),
        )
    except Exception as e:
        item.status = ProcessingStatus.ERROR
        item.error_message = str(e)
        logger.exception("Analysis failed for %s", photo_id)
        return APIResponse(success=False, message=f"Analysis failed: {e}")


@router.post("/analyze-batch")
async def analyze_batch(
    photo_ids: list[str] | None = None,
    context: BatchContext | None = None,
) -> APIResponse:
    """Analyze multiple photos. If no IDs given, analyze all pending photos."""
    settings = load_settings()
    if not settings.openai_api_key:
        return APIResponse(success=False, message="OpenAI API key not configured")

    if photo_ids is None:
        photo_ids = [
            pid
            for pid, p in photo_store.items()
            if p.status in (ProcessingStatus.PENDING, ProcessingStatus.ERROR)
        ]

    if not photo_ids:
        return APIResponse(success=True, message="No photos to analyze")

    results: list[dict] = []

    for pid in photo_ids:
        item = photo_store.get(pid)
        if not item:
            continue
        item.status = ProcessingStatus.ANALYZING

    for pid in photo_ids:
        item = photo_store.get(pid)
        if not item:
            continue
        try:
            metadata = await analyze_photo(
                item.filepath, settings.openai_api_key, context
            )
            item.metadata = metadata
            item.status = ProcessingStatus.READY
            results.append({"id": pid, "status": "ready"})
        except Exception as e:
            item.status = ProcessingStatus.ERROR
            item.error_message = str(e)
            results.append({"id": pid, "status": "error", "error": str(e)})
            logger.exception("Batch analysis failed for %s", pid)

    ready = sum(1 for r in results if r["status"] == "ready")
    errors = sum(1 for r in results if r["status"] == "error")
    return APIResponse(
        success=True,
        message=f"Analyzed {ready} photo(s), {errors} error(s)",
        data=results,
    )


@router.put("/{photo_id}")
async def update_metadata(
    photo_id: str, update: MetadataUpdateRequest
) -> APIResponse:
    """Manually update metadata for a photo."""
    item = photo_store.get(photo_id)
    if not item:
        return APIResponse(success=False, message="Photo not found")

    update_data = update.model_dump(exclude_none=True)
    for key, value in update_data.items():
        setattr(item.metadata, key, value)

    if item.status == ProcessingStatus.PENDING:
        item.status = ProcessingStatus.READY

    return APIResponse(
        success=True,
        message="Metadata updated",
        data=item.model_dump(),
    )


@router.post("/embed/{photo_id}")
async def embed_metadata(photo_id: str) -> APIResponse:
    """Embed current metadata into the photo file as IPTC/XMP."""
    item = photo_store.get(photo_id)
    if not item:
        return APIResponse(success=False, message="Photo not found")

    success = write_metadata(item.filepath, item.metadata)
    if success:
        return APIResponse(success=True, message="Metadata embedded into file")
    return APIResponse(
        success=False,
        message="Failed to embed metadata. Is ExifTool installed?",
    )


@router.post("/embed-batch")
async def embed_batch() -> APIResponse:
    """Embed metadata into all ready photos."""
    embedded = 0
    failed = 0
    for item in photo_store.values():
        if item.status == ProcessingStatus.READY:
            if write_metadata(item.filepath, item.metadata):
                embedded += 1
            else:
                failed += 1
    return APIResponse(
        success=True,
        message=f"Embedded metadata in {embedded} file(s), {failed} failed",
    )

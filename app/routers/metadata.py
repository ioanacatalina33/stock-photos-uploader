from __future__ import annotations

import asyncio
import csv
import io
import logging

from fastapi import APIRouter, File, UploadFile

from fastapi import Body

from app.categories import ADOBE_STOCK_CATEGORIES, SHUTTERSTOCK_CATEGORIES
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


def _norm_header(h: str) -> str:
    return h.strip().lower().replace("_", " ").replace("-", " ")


def _parse_keywords(value: str) -> list[str]:
    if not value:
        return []
    return [k.strip() for k in value.split(",") if k.strip()][:50]


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in ("yes", "true", "1", "y", "editorial")


def _find_photo_by_filename(name: str):
    name = (name or "").strip()
    if not name:
        return None
    for item in photo_store.values():
        if item.filename == name or item.original_filename == name:
            return item
    return None


@router.post("/import-csv")
async def import_csv(file: UploadFile = File(...)) -> APIResponse:
    """Import a CSV to populate metadata for existing photos.

    Auto-detects the format by header columns:
    - Unified:     Filename, Title, Description, Keywords, Adobe Category,
                   Shutterstock Category 1, Shutterstock Category 2, Editorial
    - Adobe:       Filename, Title, Keywords, Category, Releases
    - Shutterstock:Filename, Description, Keywords, Categories, Editorial, R-rated
    Rows are matched to photos by Filename (or original filename).
    """
    if not photo_store:
        return APIResponse(success=False, message="No photos uploaded yet")

    try:
        raw = (await file.read()).decode("utf-8-sig")
    except UnicodeDecodeError:
        return APIResponse(success=False, message="CSV must be UTF-8 encoded")

    reader = csv.DictReader(io.StringIO(raw))
    if not reader.fieldnames:
        return APIResponse(success=False, message="CSV has no header row")

    headers = {_norm_header(h): h for h in reader.fieldnames}

    if "filename" not in headers:
        return APIResponse(success=False, message="CSV must contain a 'Filename' column")

    has_title = "title" in headers
    has_description = "description" in headers
    has_keywords = "keywords" in headers
    has_adobe_cat = "adobe category" in headers or "category" in headers
    has_ss_cat = (
        "shutterstock category 1" in headers
        or "categories" in headers
        or "shutterstock category" in headers
    )
    has_editorial = "editorial" in headers

    updated = 0
    not_found: list[str] = []
    total = 0

    for row in reader:
        total += 1
        filename = (row.get(headers["filename"]) or "").strip()
        item = _find_photo_by_filename(filename)
        if not item:
            if filename:
                not_found.append(filename)
            continue

        m = item.metadata

        if has_title:
            val = (row.get(headers["title"]) or "").strip()
            if val:
                m.title = val[:200]

        if has_description:
            val = (row.get(headers["description"]) or "").strip()
            if val:
                m.description = val[:2048]

        if has_keywords:
            val = row.get(headers["keywords"]) or ""
            kws = _parse_keywords(val)
            if kws:
                m.keywords = kws

        if has_adobe_cat:
            key = headers.get("adobe category") or headers.get("category")
            val = (row.get(key) or "").strip() if key else ""
            if val:
                try:
                    num = int(val)
                    if num in ADOBE_STOCK_CATEGORIES:
                        m.adobe_category = num
                except ValueError:
                    pass

        if has_ss_cat:
            if "shutterstock category 1" in headers:
                v1 = (row.get(headers["shutterstock category 1"]) or "").strip()
                if v1 and v1 in SHUTTERSTOCK_CATEGORIES:
                    m.shutterstock_category_1 = v1
                if "shutterstock category 2" in headers:
                    v2 = (row.get(headers["shutterstock category 2"]) or "").strip()
                    if v2 and v2 in SHUTTERSTOCK_CATEGORIES:
                        m.shutterstock_category_2 = v2
            elif "categories" in headers:
                val = (row.get(headers["categories"]) or "").strip()
                if val:
                    parts = [p.strip() for p in val.split(",") if p.strip()]
                    if parts and parts[0] in SHUTTERSTOCK_CATEGORIES:
                        m.shutterstock_category_1 = parts[0]
                    if len(parts) > 1 and parts[1] in SHUTTERSTOCK_CATEGORIES:
                        m.shutterstock_category_2 = parts[1]

        if has_editorial:
            val = row.get(headers["editorial"]) or ""
            m.editorial = _parse_bool(val)

        if item.status == ProcessingStatus.PENDING:
            item.status = ProcessingStatus.READY

        updated += 1

    msg = f"Updated {updated} of {total} row(s)"
    if not_found:
        msg += f"; {len(not_found)} filename(s) not found"

    return APIResponse(
        success=True,
        message=msg,
        data={"updated": updated, "total": total, "not_found": not_found},
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

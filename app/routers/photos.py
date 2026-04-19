from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, UploadFile, File
from PIL import Image

from app.config import get_upload_dir
from app.models.schemas import APIResponse, PhotoItem, ProcessingStatus
from app.services.metadata_writer import extract_embedded_metadata

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/photos", tags=["photos"])

THUMB_MAX_SIZE = (400, 400)
THUMB_QUALITY = 80

photo_store: dict[str, PhotoItem] = {}


def _get_thumb_dir() -> Path:
    d = get_upload_dir() / "thumbs"
    d.mkdir(exist_ok=True)
    return d


def _store_path() -> Path:
    return get_upload_dir() / ".store.json"


def _persist_store() -> None:
    """Write the in-memory store to disk so it survives server restarts."""
    try:
        data = {pid: item.model_dump(mode="json") for pid, item in photo_store.items()}
        _store_path().write_text(json.dumps(data, indent=2))
    except Exception as e:
        logger.warning("Failed to persist photo store: %s", e)


def _load_store() -> None:
    """Load the persisted store from disk on startup, then prune orphan files."""
    path = _store_path()
    if path.exists():
        try:
            raw = json.loads(path.read_text())
            for pid, payload in raw.items():
                try:
                    item = PhotoItem.model_validate(payload)
                    if Path(item.filepath).exists():
                        photo_store[pid] = item
                except Exception as e:
                    logger.warning("Skipping invalid stored item %s: %s", pid, e)
        except Exception as e:
            logger.warning("Failed to load photo store: %s", e)
    _cleanup_orphans()
    _persist_store()


def _cleanup_orphans() -> None:
    """Delete files in uploads/ and uploads/thumbs/ that are not tracked in the store."""
    upload_dir = get_upload_dir()
    tracked_files = {Path(item.filepath).name for item in photo_store.values()}
    tracked_thumbs = {f"{pid}_thumb.jpg" for pid in photo_store.keys()}

    removed = 0
    for f in upload_dir.iterdir():
        if f.is_file() and f.suffix.lower() in (".jpg", ".jpeg", ".png", ".tiff", ".tif"):
            if f.name not in tracked_files:
                try:
                    f.unlink()
                    removed += 1
                except Exception:
                    pass

    thumb_dir = _get_thumb_dir()
    for f in thumb_dir.iterdir():
        if f.is_file() and f.name not in tracked_thumbs:
            try:
                f.unlink()
                removed += 1
            except Exception:
                pass

    if removed:
        logger.info("Cleaned up %d orphan file(s) from uploads/", removed)


_load_store()


def _create_thumbnail(source: Path, photo_id: str) -> Path:
    thumb_path = _get_thumb_dir() / f"{photo_id}_thumb.jpg"
    with Image.open(source) as img:
        img.thumbnail(THUMB_MAX_SIZE, Image.LANCZOS)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.save(thumb_path, "JPEG", quality=THUMB_QUALITY)
    return thumb_path


@router.post("/upload")
async def upload_photos(files: list[UploadFile] = File(...)) -> APIResponse:
    """Upload one or more photos for processing."""
    upload_dir = get_upload_dir()
    added: list[dict] = []

    for file in files:
        if not file.filename:
            continue
        ext = Path(file.filename).suffix.lower()
        if ext not in (".jpg", ".jpeg", ".png", ".tiff", ".tif"):
            continue

        photo_id = uuid.uuid4().hex[:12]
        safe_name = f"{photo_id}{ext}"
        filepath = upload_dir / safe_name

        content = await file.read()
        filepath.write_bytes(content)

        width, height = 0, 0
        try:
            with Image.open(filepath) as img:
                width, height = img.size
            _create_thumbnail(filepath, photo_id)
        except Exception:
            pass

        item = PhotoItem(
            id=photo_id,
            filename=safe_name,
            original_filename=file.filename,
            filepath=str(filepath),
            thumbnail_url=f"/api/photos/{photo_id}/thumbnail",
            width=width,
            height=height,
            file_size=len(content),
        )

        try:
            embedded = extract_embedded_metadata(str(filepath))
            if embedded is not None:
                item.metadata = embedded
                if embedded.title.strip() and embedded.keywords:
                    item.status = ProcessingStatus.READY
        except Exception:
            logger.exception("Failed to read embedded metadata from %s", filepath)

        photo_store[photo_id] = item
        added.append(item.model_dump())

    if added:
        _persist_store()

    return APIResponse(
        success=True,
        message=f"Uploaded {len(added)} photo(s)",
        data=added,
    )


@router.get("/")
async def list_photos() -> APIResponse:
    """List all uploaded photos with their metadata."""
    items = [p.model_dump() for p in photo_store.values()]
    return APIResponse(success=True, data=items)


@router.get("/{photo_id}")
async def get_photo(photo_id: str) -> APIResponse:
    item = photo_store.get(photo_id)
    if not item:
        return APIResponse(success=False, message="Photo not found")
    return APIResponse(success=True, data=item.model_dump())


@router.delete("/{photo_id}")
async def delete_photo(photo_id: str) -> APIResponse:
    item = photo_store.pop(photo_id, None)
    if not item:
        return APIResponse(success=False, message="Photo not found")
    path = Path(item.filepath)
    if path.exists():
        path.unlink()
    thumb = _get_thumb_dir() / f"{photo_id}_thumb.jpg"
    thumb.unlink(missing_ok=True)
    _persist_store()
    return APIResponse(success=True, message="Photo deleted")


@router.delete("/")
async def clear_all_photos() -> APIResponse:
    for pid, item in photo_store.items():
        path = Path(item.filepath)
        if path.exists():
            path.unlink()
        thumb = _get_thumb_dir() / f"{pid}_thumb.jpg"
        thumb.unlink(missing_ok=True)
    count = len(photo_store)
    photo_store.clear()
    _persist_store()
    return APIResponse(success=True, message=f"Cleared {count} photo(s)")


@router.get("/{photo_id}/thumbnail")
async def get_thumbnail(photo_id: str):
    """Serve a small pre-generated thumbnail for fast grid loading."""
    from fastapi.responses import FileResponse, JSONResponse

    item = photo_store.get(photo_id)
    if not item:
        return JSONResponse({"error": "not found"}, status_code=404)

    thumb = _get_thumb_dir() / f"{photo_id}_thumb.jpg"
    if thumb.exists():
        return FileResponse(str(thumb), media_type="image/jpeg")

    path = Path(item.filepath)
    if not path.exists():
        return JSONResponse({"error": "file missing"}, status_code=404)

    try:
        _create_thumbnail(path, photo_id)
        return FileResponse(str(thumb), media_type="image/jpeg")
    except Exception:
        return FileResponse(str(path), media_type="image/jpeg")

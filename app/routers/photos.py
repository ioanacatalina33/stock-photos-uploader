from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, UploadFile, File
from PIL import Image

from app.config import get_upload_dir
from app.models.schemas import APIResponse, PhotoItem, ProcessingStatus

router = APIRouter(prefix="/api/photos", tags=["photos"])

THUMB_MAX_SIZE = (400, 400)
THUMB_QUALITY = 80

# In-memory photo store (keyed by photo id)
photo_store: dict[str, PhotoItem] = {}


def _get_thumb_dir() -> Path:
    d = get_upload_dir() / "thumbs"
    d.mkdir(exist_ok=True)
    return d


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
        photo_store[photo_id] = item
        added.append(item.model_dump())

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

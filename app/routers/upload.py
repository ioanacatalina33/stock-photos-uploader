from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.config import load_settings
from app.models.schemas import (
    APIResponse,
    ProcessingStatus,
    UploadRequest,
)
from app.routers.photos import photo_store
from app.services.csv_generator import (
    generate_adobe_csv,
    generate_shutterstock_csv,
    save_csv,
)
from app.services.adobe_uploader import upload_to_adobe, test_adobe_connection
from app.services.shutter_uploader import (
    upload_to_shutterstock,
    test_shutterstock_connection,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/upload", tags=["upload"])


def _get_ready_photos(photo_ids: list[str] | None = None):
    if photo_ids:
        return [
            photo_store[pid]
            for pid in photo_ids
            if pid in photo_store
            and photo_store[pid].status == ProcessingStatus.READY
        ]
    return [
        p for p in photo_store.values() if p.status == ProcessingStatus.READY
    ]


def _parse_ids_param(ids: str | None) -> list[str] | None:
    if not ids:
        return None
    parts = [s.strip() for s in ids.split(",") if s.strip()]
    return parts or None


@router.get("/csv/adobe")
async def download_adobe_csv(ids: str | None = None):
    """Download Adobe Stock CSV. Optional ?ids=a,b,c filters to selected ready photos."""
    photos = _get_ready_photos(_parse_ids_param(ids))
    if not photos:
        return APIResponse(success=False, message="No ready photos")
    content = generate_adobe_csv(photos)
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=adobe_stock.csv"},
    )


@router.get("/csv/shutterstock")
async def download_shutterstock_csv(ids: str | None = None):
    """Download Shutterstock CSV. Optional ?ids=a,b,c filters to selected ready photos."""
    photos = _get_ready_photos(_parse_ids_param(ids))
    if not photos:
        return APIResponse(success=False, message="No ready photos")
    content = generate_shutterstock_csv(photos)
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=shutterstock.csv"
        },
    )


@router.post("/adobe")
async def upload_adobe(request: UploadRequest) -> APIResponse:
    """Upload photos and CSV to Adobe Stock via SFTP."""
    settings = load_settings()
    if not settings.adobe_stock:
        return APIResponse(
            success=False, message="Adobe Stock credentials not configured"
        )

    photos = _get_ready_photos(request.photo_ids)
    if not photos:
        return APIResponse(success=False, message="No ready photos to upload")

    csv_content = generate_adobe_csv(photos)
    csv_path = Path(tempfile.mktemp(suffix=".csv"))
    save_csv(csv_content, str(csv_path))

    filepaths = [p.filepath for p in photos]
    results = []
    async for progress in upload_to_adobe(
        filepaths, str(csv_path), settings.adobe_stock
    ):
        results.append(progress.model_dump())
        if progress.status == "uploaded":
            for p in photos:
                if p.filename == progress.filename:
                    p.status = ProcessingStatus.UPLOADED

    csv_path.unlink(missing_ok=True)

    errors = [r for r in results if r["status"] == "error"]
    if errors:
        return APIResponse(
            success=False,
            message=f"Upload completed with {len(errors)} error(s)",
            data=results,
        )
    return APIResponse(success=True, message="Upload complete", data=results)


@router.post("/shutterstock")
async def upload_shutterstock(request: UploadRequest) -> APIResponse:
    """Upload photos and CSV to Shutterstock via FTPS."""
    settings = load_settings()
    if not settings.shutterstock:
        return APIResponse(
            success=False, message="Shutterstock credentials not configured"
        )

    photos = _get_ready_photos(request.photo_ids)
    if not photos:
        return APIResponse(success=False, message="No ready photos to upload")

    csv_content = generate_shutterstock_csv(photos)
    csv_path = Path(tempfile.mktemp(suffix=".csv"))
    save_csv(csv_content, str(csv_path))

    filepaths = [p.filepath for p in photos]
    results = []
    async for progress in upload_to_shutterstock(
        filepaths, str(csv_path), settings.shutterstock
    ):
        results.append(progress.model_dump())
        if progress.status == "uploaded":
            for p in photos:
                if p.filename == progress.filename:
                    p.status = ProcessingStatus.UPLOADED

    csv_path.unlink(missing_ok=True)

    errors = [r for r in results if r["status"] == "error"]
    if errors:
        return APIResponse(
            success=False,
            message=f"Upload completed with {len(errors)} error(s)",
            data=results,
        )
    return APIResponse(success=True, message="Upload complete", data=results)


@router.post("/both")
async def upload_both(request: UploadRequest) -> APIResponse:
    """Upload to both Adobe Stock and Shutterstock."""
    settings = load_settings()
    photos = _get_ready_photos(request.photo_ids)
    if not photos:
        return APIResponse(success=False, message="No ready photos to upload")

    filepaths = [p.filepath for p in photos]
    results = {"adobe_stock": [], "shutterstock": []}

    if settings.adobe_stock:
        csv_content = generate_adobe_csv(photos)
        csv_path = Path(tempfile.mktemp(suffix=".csv"))
        save_csv(csv_content, str(csv_path))
        async for progress in upload_to_adobe(
            filepaths, str(csv_path), settings.adobe_stock
        ):
            results["adobe_stock"].append(progress.model_dump())
        csv_path.unlink(missing_ok=True)
    else:
        results["adobe_stock"] = [{"status": "error", "message": "Credentials not configured"}]

    if settings.shutterstock:
        csv_content = generate_shutterstock_csv(photos)
        csv_path = Path(tempfile.mktemp(suffix=".csv"))
        save_csv(csv_content, str(csv_path))
        async for progress in upload_to_shutterstock(
            filepaths, str(csv_path), settings.shutterstock
        ):
            results["shutterstock"].append(progress.model_dump())
        csv_path.unlink(missing_ok=True)
    else:
        results["shutterstock"] = [{"status": "error", "message": "Credentials not configured"}]

    for p in photos:
        p.status = ProcessingStatus.UPLOADED

    return APIResponse(success=True, message="Upload to both complete", data=results)


@router.post("/test/{platform}")
async def test_connection(platform: str) -> APIResponse:
    """Test connection to a platform. Platform: adobe_stock or shutterstock."""
    settings = load_settings()

    if platform == "adobe_stock":
        if not settings.adobe_stock:
            return APIResponse(success=False, message="Credentials not set")
        ok, msg = test_adobe_connection(settings.adobe_stock)
    elif platform == "shutterstock":
        if not settings.shutterstock:
            return APIResponse(success=False, message="Credentials not set")
        ok, msg = test_shutterstock_connection(settings.shutterstock)
    else:
        return APIResponse(success=False, message="Unknown platform")

    return APIResponse(success=ok, message=msg)

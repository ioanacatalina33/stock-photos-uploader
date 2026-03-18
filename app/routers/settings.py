from __future__ import annotations

from fastapi import APIRouter

from app.config import load_settings, save_settings
from app.models.schemas import APIResponse, AppSettings, PlatformCredentials

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/")
async def get_settings() -> APIResponse:
    """Get current settings (passwords masked)."""
    settings = load_settings()
    data = {
        "openai_api_key": _mask(settings.openai_api_key),
        "adobe_stock": _mask_creds(settings.adobe_stock),
        "shutterstock": _mask_creds(settings.shutterstock),
    }
    return APIResponse(success=True, data=data)


@router.put("/")
async def update_settings(
    openai_api_key: str | None = None,
    adobe_host: str | None = None,
    adobe_username: str | None = None,
    adobe_password: str | None = None,
    shutterstock_host: str | None = None,
    shutterstock_username: str | None = None,
    shutterstock_password: str | None = None,
) -> APIResponse:
    """Update application settings."""
    settings = load_settings()

    if openai_api_key is not None:
        settings.openai_api_key = openai_api_key

    if adobe_username is not None or adobe_password is not None:
        if settings.adobe_stock is None:
            settings.adobe_stock = PlatformCredentials(
                host="sftp.contributor.adobestock.com",
                username="",
                password="",
            )
        if adobe_host is not None:
            settings.adobe_stock.host = adobe_host
        if adobe_username is not None:
            settings.adobe_stock.username = adobe_username
        if adobe_password is not None:
            settings.adobe_stock.password = adobe_password

    if shutterstock_username is not None or shutterstock_password is not None:
        if settings.shutterstock is None:
            settings.shutterstock = PlatformCredentials(
                host="ftps.shutterstock.com",
                username="",
                password="",
            )
        if shutterstock_host is not None:
            settings.shutterstock.host = shutterstock_host
        if shutterstock_username is not None:
            settings.shutterstock.username = shutterstock_username
        if shutterstock_password is not None:
            settings.shutterstock.password = shutterstock_password

    save_settings(settings)
    return APIResponse(success=True, message="Settings saved")


def _mask(value: str) -> str:
    if not value or len(value) < 8:
        return "***" if value else ""
    return value[:4] + "****" + value[-4:]


def _mask_creds(creds: PlatformCredentials | None) -> dict | None:
    if not creds:
        return None
    return {
        "host": creds.host,
        "username": creds.username,
        "password": _mask(creds.password),
    }

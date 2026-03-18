from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from cryptography.fernet import Fernet

from app.models.schemas import AppSettings, PlatformCredentials

logger = logging.getLogger(__name__)

CONFIG_DIR = Path(__file__).resolve().parent.parent
CONFIG_FILE = CONFIG_DIR / "config.enc"
KEY_FILE = CONFIG_DIR / ".config_key"
UPLOAD_DIR = CONFIG_DIR / "uploads"


def _get_or_create_key() -> bytes:
    if KEY_FILE.exists():
        return KEY_FILE.read_bytes()
    key = Fernet.generate_key()
    KEY_FILE.write_bytes(key)
    return key


def _cipher() -> Fernet:
    return Fernet(_get_or_create_key())


def load_settings() -> AppSettings:
    """Load settings from encrypted config file, falling back to env vars."""
    settings = AppSettings()

    api_key = os.getenv("OPENAI_API_KEY", "")

    if CONFIG_FILE.exists():
        try:
            encrypted = CONFIG_FILE.read_bytes()
            decrypted = _cipher().decrypt(encrypted)
            data = json.loads(decrypted)
            settings = AppSettings(**data)
        except Exception:
            logger.exception("Failed to load config, using defaults")

    if api_key and not settings.openai_api_key:
        settings.openai_api_key = api_key

    return settings


def save_settings(settings: AppSettings) -> None:
    """Save settings to encrypted config file."""
    data = settings.model_dump(mode="json")
    encrypted = _cipher().encrypt(json.dumps(data).encode())
    CONFIG_FILE.write_bytes(encrypted)
    logger.info("Settings saved")


def get_upload_dir() -> Path:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return UPLOAD_DIR

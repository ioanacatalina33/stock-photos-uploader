from __future__ import annotations

import logging
from pathlib import Path
from typing import AsyncIterator

import paramiko

from app.models.schemas import PlatformCredentials, UploadProgress

logger = logging.getLogger(__name__)

ADOBE_SFTP_HOST = "sftp.contributor.adobestock.com"
ADOBE_SFTP_PORT = 22


async def upload_to_adobe(
    photo_uploads: list[tuple[str, str]],
    csv_path: str | None,
    credentials: PlatformCredentials,
) -> AsyncIterator[UploadProgress]:
    """Upload photos and CSV to Adobe Stock via SFTP.

    ``photo_uploads`` is a list of ``(local_filepath, remote_filename)`` pairs
    so the file shows up on Adobe Stock with the photographer's original name
    instead of our internal UUID-based name.

    Credentials come from the Adobe Stock Contributor portal:
    go to Upload > SFTP > Generate Password.
    """
    host = credentials.host or ADOBE_SFTP_HOST
    transport = None
    sftp = None

    try:
        transport = paramiko.Transport((host, ADOBE_SFTP_PORT))
        transport.connect(
            username=credentials.username,
            password=credentials.password,
        )
        sftp = paramiko.SFTPClient.from_transport(transport)
        if sftp is None:
            raise ConnectionError("Failed to open SFTP session")

        items: list[tuple[str, str]] = list(photo_uploads)
        if csv_path:
            items.append((csv_path, Path(csv_path).name))

        for filepath, remote_name in items:
            filename = remote_name
            try:
                yield UploadProgress(
                    photo_id=filename,
                    filename=filename,
                    platform="adobe_stock",
                    status="uploading",
                    message=f"Uploading {filename}...",
                )

                sftp.put(filepath, f"/{filename}")

                yield UploadProgress(
                    photo_id=filename,
                    filename=filename,
                    platform="adobe_stock",
                    status="uploaded",
                    message=f"Uploaded {filename}",
                )
            except Exception as e:
                logger.exception("Failed to upload %s to Adobe Stock", filename)
                yield UploadProgress(
                    photo_id=filename,
                    filename=filename,
                    platform="adobe_stock",
                    status="error",
                    message=str(e),
                )

    except Exception as e:
        logger.exception("Adobe Stock SFTP connection failed")
        yield UploadProgress(
            photo_id="connection",
            filename="",
            platform="adobe_stock",
            status="error",
            message=f"Connection failed: {e}",
        )
    finally:
        if sftp:
            sftp.close()
        if transport:
            transport.close()


def test_adobe_connection(credentials: PlatformCredentials) -> tuple[bool, str]:
    """Test SFTP connection to Adobe Stock. Returns (success, message)."""
    host = credentials.host or ADOBE_SFTP_HOST
    transport = None
    try:
        transport = paramiko.Transport((host, ADOBE_SFTP_PORT))
        transport.connect(
            username=credentials.username,
            password=credentials.password,
        )
        return True, "Connected successfully"
    except Exception as e:
        return False, str(e)
    finally:
        if transport:
            transport.close()

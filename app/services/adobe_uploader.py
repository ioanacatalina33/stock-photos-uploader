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
    filepaths: list[str],
    csv_path: str | None,
    credentials: PlatformCredentials,
) -> AsyncIterator[UploadProgress]:
    """Upload photos and CSV to Adobe Stock via SFTP.

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

        all_files = list(filepaths)
        if csv_path:
            all_files.append(csv_path)

        for filepath in all_files:
            filename = Path(filepath).name
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

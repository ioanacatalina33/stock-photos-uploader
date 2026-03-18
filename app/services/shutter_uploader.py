from __future__ import annotations

import ftplib
import logging
import ssl
from pathlib import Path
from typing import AsyncIterator

from app.models.schemas import PlatformCredentials, UploadProgress

logger = logging.getLogger(__name__)

SHUTTERSTOCK_FTPS_HOST = "ftps.shutterstock.com"
SHUTTERSTOCK_FTPS_PORT = 21


def _connect_ftps(credentials: PlatformCredentials) -> ftplib.FTP_TLS:
    """Create an explicit FTPS connection to Shutterstock."""
    host = credentials.host or SHUTTERSTOCK_FTPS_HOST
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    ftp = ftplib.FTP_TLS(context=ctx)
    ftp.connect(host, SHUTTERSTOCK_FTPS_PORT, timeout=30)
    ftp.login(credentials.username, credentials.password)
    ftp.prot_p()
    return ftp


async def upload_to_shutterstock(
    filepaths: list[str],
    csv_path: str | None,
    credentials: PlatformCredentials,
) -> AsyncIterator[UploadProgress]:
    """Upload photos and CSV to Shutterstock via FTPS.

    Credentials come from the Shutterstock Contributor portal FTPS settings.
    """
    ftp = None
    try:
        ftp = _connect_ftps(credentials)

        all_files = list(filepaths)
        if csv_path:
            all_files.append(csv_path)

        for filepath in all_files:
            filename = Path(filepath).name
            try:
                yield UploadProgress(
                    photo_id=filename,
                    filename=filename,
                    platform="shutterstock",
                    status="uploading",
                    message=f"Uploading {filename}...",
                )

                with open(filepath, "rb") as f:
                    ftp.storbinary(f"STOR {filename}", f)

                yield UploadProgress(
                    photo_id=filename,
                    filename=filename,
                    platform="shutterstock",
                    status="uploaded",
                    message=f"Uploaded {filename}",
                )
            except Exception as e:
                logger.exception("Failed to upload %s to Shutterstock", filename)
                yield UploadProgress(
                    photo_id=filename,
                    filename=filename,
                    platform="shutterstock",
                    status="error",
                    message=str(e),
                )

    except Exception as e:
        logger.exception("Shutterstock FTPS connection failed")
        yield UploadProgress(
            photo_id="connection",
            filename="",
            platform="shutterstock",
            status="error",
            message=f"Connection failed: {e}",
        )
    finally:
        if ftp:
            try:
                ftp.quit()
            except Exception:
                ftp.close()


def test_shutterstock_connection(
    credentials: PlatformCredentials,
) -> tuple[bool, str]:
    """Test FTPS connection to Shutterstock. Returns (success, message)."""
    ftp = None
    try:
        ftp = _connect_ftps(credentials)
        return True, "Connected successfully"
    except Exception as e:
        return False, str(e)
    finally:
        if ftp:
            try:
                ftp.quit()
            except Exception:
                ftp.close()

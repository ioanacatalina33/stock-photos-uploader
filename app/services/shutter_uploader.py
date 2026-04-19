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


class _ReusedSslSocket(ssl.SSLSocket):
    """Workaround for Python ftplib FTPS data-channel session reuse.

    Some FTPS servers (including Shutterstock) require TLS session reuse
    on the data channel. Python's FTP_TLS doesn't handle this by default,
    causing uploads to fail silently. This subclass patches unwrap() to
    keep the session alive.
    """

    def unwrap(self):
        return self._sslobj


class _SessionReuseFTPS(ftplib.FTP_TLS):
    """FTP_TLS subclass that reuses TLS sessions for data connections."""

    def ntransfercmd(self, cmd, rest=None):
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        if self._prot_p:
            conn = self.context.wrap_socket(
                conn,
                server_hostname=self.host,
                session=self.sock.session,
            )
        return conn, size


def _connect_ftps(credentials: PlatformCredentials) -> ftplib.FTP_TLS:
    """Create an explicit FTPS connection to Shutterstock."""
    host = credentials.host or SHUTTERSTOCK_FTPS_HOST
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    ftp = _SessionReuseFTPS(context=ctx)
    ftp.connect(host, SHUTTERSTOCK_FTPS_PORT, timeout=30)
    ftp.login(credentials.username, credentials.password)
    ftp.prot_p()
    ftp.set_pasv(True)
    logger.info("FTPS connected to %s as %s", host, credentials.username)
    return ftp


async def upload_to_shutterstock(
    photo_uploads: list[tuple[str, str]],
    csv_path: str | None,
    credentials: PlatformCredentials,
) -> AsyncIterator[UploadProgress]:
    """Upload photos and CSV to Shutterstock via FTPS.

    ``photo_uploads`` is a list of ``(local_filepath, remote_filename)`` pairs
    so the file lands on Shutterstock with the photographer's original name
    (matching the Filename column of the CSV).

    Credentials come from the Shutterstock Contributor portal FTPS settings.
    """
    ftp = None
    try:
        ftp = _connect_ftps(credentials)

        items: list[tuple[str, str]] = list(photo_uploads)
        if csv_path:
            items.append((csv_path, Path(csv_path).name))

        for filepath, remote_name in items:
            filename = remote_name
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

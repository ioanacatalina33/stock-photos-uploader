from __future__ import annotations

import logging
import shutil
import subprocess

from app.models.schemas import PhotoMetadata

logger = logging.getLogger(__name__)


def _exiftool_available() -> bool:
    return shutil.which("exiftool") is not None


def write_metadata(filepath: str, metadata: PhotoMetadata) -> bool:
    """Embed IPTC/XMP metadata into a JPEG file using ExifTool.

    Both Adobe Stock and Shutterstock read these embedded fields:
      - IPTC:Headline / XMP:Title  -> title
      - IPTC:Caption-Abstract / XMP:Description -> description
      - IPTC:Keywords / XMP:Subject -> keywords

    Returns True on success, False on failure.
    """
    if not _exiftool_available():
        logger.warning("ExifTool not found -- skipping metadata embedding")
        return False

    args = [
        "exiftool",
        "-overwrite_original",
        f"-IPTC:Headline={metadata.title}",
        f"-XMP:Title={metadata.title}",
        f"-IPTC:Caption-Abstract={metadata.description}",
        f"-XMP:Description={metadata.description}",
    ]

    # Clear existing keywords first, then add new ones
    args.append("-IPTC:Keywords=")
    args.append("-XMP:Subject=")
    for kw in metadata.keywords:
        args.append(f"-IPTC:Keywords={kw}")
        args.append(f"-XMP:Subject={kw}")

    args.append(filepath)

    try:
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            logger.error("ExifTool error: %s", result.stderr)
            return False
        logger.info("Metadata embedded into %s", filepath)
        return True
    except subprocess.TimeoutExpired:
        logger.error("ExifTool timed out for %s", filepath)
        return False
    except Exception:
        logger.exception("Failed to write metadata to %s", filepath)
        return False


def read_embedded_metadata(filepath: str) -> dict:
    """Read IPTC/XMP metadata from a file. Returns a dict of fields."""
    if not _exiftool_available():
        return {}

    try:
        result = subprocess.run(
            [
                "exiftool",
                "-json",
                "-IPTC:Headline",
                "-IPTC:Caption-Abstract",
                "-IPTC:Keywords",
                "-XMP:Title",
                "-XMP:Description",
                "-XMP:Subject",
                filepath,
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode != 0:
            return {}

        import json

        data = json.loads(result.stdout)
        return data[0] if data else {}
    except Exception:
        logger.exception("Failed to read metadata from %s", filepath)
        return {}


def extract_embedded_metadata(filepath: str) -> PhotoMetadata | None:
    """Read embedded IPTC/XMP fields and return a populated ``PhotoMetadata``,
    or ``None`` if no useful fields were found.

    Used at upload time to pre-fill metadata for files that already carry
    embedded IPTC/XMP (e.g. previously processed exports), so the user does
    not have to re-run AI analysis.
    """
    raw = read_embedded_metadata(filepath)
    if not raw:
        return None

    title = (raw.get("Headline") or raw.get("Title") or "").strip()
    description = (raw.get("Caption-Abstract") or raw.get("Description") or "").strip()
    raw_keywords = raw.get("Keywords") or raw.get("Subject") or []
    if isinstance(raw_keywords, str):
        keywords = [k.strip() for k in raw_keywords.split(",") if k.strip()]
    elif isinstance(raw_keywords, list):
        keywords = [str(k).strip() for k in raw_keywords if str(k).strip()]
    else:
        keywords = []

    if not (title or description or keywords):
        return None

    return PhotoMetadata(
        title=title[:200],
        description=description[:2048],
        keywords=keywords,
    )

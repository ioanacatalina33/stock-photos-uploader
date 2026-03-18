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

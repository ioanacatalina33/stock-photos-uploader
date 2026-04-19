from __future__ import annotations

import csv
import io
import logging
import re
from pathlib import Path

from app.models.schemas import PhotoItem

logger = logging.getLogger(__name__)

_KEYWORD_INVALID = re.compile(r'[",;\r\n\t]+')
_WHITESPACE = re.compile(r"\s+")


def resolve_upload_names(photos: list[PhotoItem]) -> dict[str, str]:
    """Map ``photo.id`` -> the filename that should appear in CSV and on the
    remote server.

    Stock platforms display whatever name we upload, so we use the photographer's
    original filename. If two photos share the same original name we suffix the
    later occurrences with ``_2``, ``_3``, ... to keep them distinct.
    """
    used: set[str] = set()
    mapping: dict[str, str] = {}
    for p in photos:
        base = p.original_filename or p.filename
        base = Path(base).name
        if base not in used:
            chosen = base
        else:
            stem = Path(base).stem
            ext = Path(base).suffix
            n = 2
            while f"{stem}_{n}{ext}" in used:
                n += 1
            chosen = f"{stem}_{n}{ext}"
        used.add(chosen)
        mapping[p.id] = chosen
    return mapping


def _clean_keyword(kw: str) -> str:
    """Strip characters that confuse stock-platform CSV parsers.

    Shutterstock in particular silently drops a keyword cell when it contains
    embedded quotes, semicolons, or line breaks, so we normalise to plain
    alphanumeric phrases of at most 50 characters.
    """
    if not kw:
        return ""
    cleaned = _KEYWORD_INVALID.sub(" ", kw)
    cleaned = _WHITESPACE.sub(" ", cleaned).strip()
    return cleaned[:50]


def _sanitize_keywords(keywords: list[str], limit: int = 50) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for kw in keywords:
        c = _clean_keyword(kw)
        if not c:
            continue
        key = c.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
        if len(out) >= limit:
            break
    return out


def generate_adobe_csv(photos: list[PhotoItem]) -> str:
    """Generate Adobe Stock CSV content.

    Columns: Filename, Title, Keywords, Category, Releases
    - Filename: photographer's original filename (must match what is uploaded)
    - Title: max 200 chars, no commas
    - Keywords: comma-separated, max 50, ordered by relevance
    - Category: number 1-21
    - Releases: model/property release filenames
    """
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Filename", "Title", "Keywords", "Category", "Releases"])

    name_map = resolve_upload_names(photos)
    for photo in photos:
        filename = name_map[photo.id]
        title = photo.metadata.title.replace(",", " ")[:200]
        keywords = ",".join(_sanitize_keywords(photo.metadata.keywords))
        category = photo.metadata.adobe_category or ""
        releases = ",".join(photo.metadata.releases)

        writer.writerow([filename, title, keywords, category, releases])

    return output.getvalue()


def generate_shutterstock_csv(photos: list[PhotoItem]) -> str:
    """Generate Shutterstock CSV content.

    Columns: Filename, Description, Keywords, Categories, Editorial, R-rated
    - Filename: exact filename
    - Description: up to 200 chars (Shutterstock truncates longer values)
    - Keywords: comma-separated, 7-50 keywords
    - Categories: primary[,secondary]
    - Editorial: yes/no
    - R-rated: yes/no (mature content flag)
    """
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        ["Filename", "Description", "Keywords", "Categories", "Editorial", "R-rated"]
    )

    name_map = resolve_upload_names(photos)
    for photo in photos:
        m = photo.metadata
        filename = name_map[photo.id]

        categories_parts = [m.shutterstock_category_1]
        if m.shutterstock_category_2:
            categories_parts.append(m.shutterstock_category_2)
        categories = ",".join(p for p in categories_parts if p)

        kws = _sanitize_keywords(m.keywords)
        if len(kws) < 7:
            logger.warning(
                "Photo %s has only %d keyword(s); Shutterstock requires at least 7",
                filename,
                len(kws),
            )
        keywords = ",".join(kws)

        description = (m.description or "").replace("\r", " ").replace("\n", " ")
        description = _WHITESPACE.sub(" ", description).strip()[:200]

        editorial = "yes" if m.editorial else "no"
        mature = "yes" if m.mature_content else "no"

        writer.writerow(
            [filename, description, keywords, categories, editorial, mature]
        )

    return output.getvalue()


def save_csv(content: str, filepath: str) -> str:
    """Save CSV content to a file. Returns the absolute path."""
    path = Path(filepath)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8-sig")
    logger.info("CSV saved to %s", path)
    return str(path.resolve())

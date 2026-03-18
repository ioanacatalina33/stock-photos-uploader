from __future__ import annotations

import csv
import io
import logging
from pathlib import Path

from app.models.schemas import PhotoItem

logger = logging.getLogger(__name__)


def generate_adobe_csv(photos: list[PhotoItem]) -> str:
    """Generate Adobe Stock CSV content.

    Columns: Filename, Title, Keywords, Category, Releases
    - Filename: exact filename including extension (max 30 chars)
    - Title: max 70 chars, no commas
    - Keywords: comma-separated, max 50, ordered by relevance
    - Category: number 1-21
    - Releases: model/property release filenames
    """
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Filename", "Title", "Keywords", "Category", "Releases"])

    for photo in photos:
        filename = photo.filename[:30]
        title = photo.metadata.title.replace(",", " ")[:70]
        keywords = ",".join(photo.metadata.keywords[:50])
        category = photo.metadata.adobe_category or ""
        releases = ",".join(photo.metadata.releases)

        writer.writerow([filename, title, keywords, category, releases])

    return output.getvalue()


def generate_shutterstock_csv(photos: list[PhotoItem]) -> str:
    """Generate Shutterstock CSV content.

    Columns: Filename, Description, Keywords, Categories, Editorial, R-rated
    - Filename: exact filename
    - Description: up to 2048 chars
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

    for photo in photos:
        m = photo.metadata
        filename = photo.filename

        categories_parts = [m.shutterstock_category_1]
        if m.shutterstock_category_2:
            categories_parts.append(m.shutterstock_category_2)
        categories = ",".join(categories_parts)

        keywords = ",".join(m.keywords[:50])
        editorial = "yes" if m.editorial else "no"
        mature = "yes" if m.mature_content else "no"

        writer.writerow([filename, m.description, keywords, categories, editorial, mature])

    return output.getvalue()


def save_csv(content: str, filepath: str) -> str:
    """Save CSV content to a file. Returns the absolute path."""
    path = Path(filepath)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8-sig")
    logger.info("CSV saved to %s", path)
    return str(path.resolve())

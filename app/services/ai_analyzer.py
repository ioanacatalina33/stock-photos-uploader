from __future__ import annotations

import base64
import json
import logging
from pathlib import Path

from openai import AsyncOpenAI

from app.categories import (
    ADOBE_STOCK_CATEGORIES,
    SHUTTERSTOCK_CATEGORIES,
    get_adobe_category_prompt,
    get_shutterstock_category_prompt,
)
from app.models.schemas import PhotoMetadata

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a stock photography metadata expert. Your job is to analyze photos and generate metadata that maximizes discoverability on Adobe Stock and Shutterstock.

Rules:
- Title: concise, descriptive, max 70 characters. No commas. Use natural language.
- Description: detailed scene description, max 200 characters. Include context, mood, setting.
- Keywords: 25-45 relevant keywords ordered by relevance. Most important first.
  Use singular nouns (cat not cats). Include specific details: breed, color, activity, setting, emotion.
  Do NOT include brand names, people's names, or subjective words like "beautiful" or "cute".
- Categories: pick the BEST matching category for each platform from the lists provided.
- editorial: true only if the image contains identifiable trademarks, logos, or recognizable people without model releases.
- mature_content: true only if the image contains sexual content, graphic medical scenes, or vulgar content.

Return valid JSON only, no markdown formatting."""


def _build_user_prompt() -> str:
    return f"""Analyze this photo and generate stock photography metadata.

{get_adobe_category_prompt()}

{get_shutterstock_category_prompt()}

Return a JSON object with exactly these fields:
{{
  "title": "string (max 70 chars, no commas)",
  "description": "string (max 200 chars)",
  "keywords": ["keyword1", "keyword2", ...],
  "adobe_category": number,
  "shutterstock_category_1": "string (primary category)",
  "shutterstock_category_2": "string (secondary category, can be empty)",
  "editorial": boolean,
  "mature_content": boolean
}}"""


def _encode_image(filepath: str) -> str:
    with open(filepath, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


async def analyze_photo(filepath: str, api_key: str) -> PhotoMetadata:
    """Analyze a photo using OpenAI Vision and return structured metadata."""
    client = AsyncOpenAI(api_key=api_key)

    ext = Path(filepath).suffix.lower()
    media_type = "image/png" if ext == ".png" else "image/jpeg"
    b64_image = _encode_image(filepath)

    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _build_user_prompt()},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{media_type};base64,{b64_image}",
                            "detail": "high",
                        },
                    },
                ],
            },
        ],
        max_tokens=1500,
        temperature=0.3,
    )

    raw = response.choices[0].message.content or "{}"
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        raw = raw.rsplit("```", 1)[0]

    data = json.loads(raw)

    adobe_cat = data.get("adobe_category")
    if adobe_cat is not None and adobe_cat not in ADOBE_STOCK_CATEGORIES:
        adobe_cat = None

    ss_cat1 = data.get("shutterstock_category_1", "")
    if ss_cat1 not in SHUTTERSTOCK_CATEGORIES:
        ss_cat1 = ""
    ss_cat2 = data.get("shutterstock_category_2", "")
    if ss_cat2 not in SHUTTERSTOCK_CATEGORIES:
        ss_cat2 = ""

    keywords = data.get("keywords", [])[:50]

    return PhotoMetadata(
        title=data.get("title", "")[:200],
        description=data.get("description", "")[:2048],
        keywords=keywords,
        adobe_category=adobe_cat,
        shutterstock_category_1=ss_cat1,
        shutterstock_category_2=ss_cat2,
        editorial=data.get("editorial", False),
        mature_content=data.get("mature_content", False),
    )

ADOBE_STOCK_CATEGORIES: dict[int, str] = {
    1: "Animals",
    2: "Buildings and Architecture",
    3: "Business",
    4: "Drinks",
    5: "The Environment",
    6: "States of Mind",
    7: "Food",
    8: "Graphic Resources",
    9: "Hobbies and Leisure",
    10: "Industry",
    11: "Landscape",
    12: "Lifestyle",
    13: "People",
    14: "Plants and Flowers",
    15: "Culture and Religion",
    16: "Science",
    17: "Social Issues",
    18: "Sports",
    19: "Technology",
    20: "Transport",
    21: "Travel",
}

SHUTTERSTOCK_CATEGORIES: list[str] = [
    "Abstract",
    "Animals/Wildlife",
    "The Arts",
    "Backgrounds/Textures",
    "Beauty/Fashion",
    "Buildings/Landmarks",
    "Business/Finance",
    "Celebrities",
    "Education",
    "Food and Drink",
    "Healthcare/Medical",
    "Holidays",
    "Industrial",
    "Interiors",
    "Miscellaneous",
    "Nature",
    "Objects",
    "Parks/Outdoor",
    "People",
    "Religion",
    "Science",
    "Signs/Symbols",
    "Sports/Recreation",
    "Technology",
    "Transportation",
    "Vintage",
]

CROSS_PLATFORM_MAPPING: dict[str, dict] = {
    "animals": {"adobe": 1, "shutterstock": "Animals/Wildlife"},
    "buildings": {"adobe": 2, "shutterstock": "Buildings/Landmarks"},
    "business": {"adobe": 3, "shutterstock": "Business/Finance"},
    "drinks": {"adobe": 4, "shutterstock": "Food and Drink"},
    "environment": {"adobe": 5, "shutterstock": "Nature"},
    "emotions": {"adobe": 6, "shutterstock": "People"},
    "food": {"adobe": 7, "shutterstock": "Food and Drink"},
    "graphic_resources": {"adobe": 8, "shutterstock": "Abstract"},
    "hobbies": {"adobe": 9, "shutterstock": "Sports/Recreation"},
    "industry": {"adobe": 10, "shutterstock": "Industrial"},
    "landscape": {"adobe": 11, "shutterstock": "Nature"},
    "lifestyle": {"adobe": 12, "shutterstock": "People"},
    "people": {"adobe": 13, "shutterstock": "People"},
    "plants": {"adobe": 14, "shutterstock": "Nature"},
    "religion": {"adobe": 15, "shutterstock": "Religion"},
    "science": {"adobe": 16, "shutterstock": "Science"},
    "social_issues": {"adobe": 17, "shutterstock": "People"},
    "sports": {"adobe": 18, "shutterstock": "Sports/Recreation"},
    "technology": {"adobe": 19, "shutterstock": "Technology"},
    "transport": {"adobe": 20, "shutterstock": "Transportation"},
    "travel": {"adobe": 21, "shutterstock": "Parks/Outdoor"},
    "abstract": {"adobe": 8, "shutterstock": "Abstract"},
    "backgrounds": {"adobe": 8, "shutterstock": "Backgrounds/Textures"},
    "beauty": {"adobe": 12, "shutterstock": "Beauty/Fashion"},
    "education": {"adobe": 16, "shutterstock": "Education"},
    "healthcare": {"adobe": 16, "shutterstock": "Healthcare/Medical"},
    "holidays": {"adobe": 9, "shutterstock": "Holidays"},
    "interiors": {"adobe": 2, "shutterstock": "Interiors"},
    "objects": {"adobe": 9, "shutterstock": "Objects"},
    "signs": {"adobe": 8, "shutterstock": "Signs/Symbols"},
    "vintage": {"adobe": 15, "shutterstock": "Vintage"},
}


def get_adobe_category_prompt() -> str:
    lines = [f"  {num}: {name}" for num, name in ADOBE_STOCK_CATEGORIES.items()]
    return "Adobe Stock categories (return the number):\n" + "\n".join(lines)


def get_shutterstock_category_prompt() -> str:
    lines = [f"  - {name}" for name in SHUTTERSTOCK_CATEGORIES]
    return (
        "Shutterstock categories (return the exact name):\n" + "\n".join(lines)
    )

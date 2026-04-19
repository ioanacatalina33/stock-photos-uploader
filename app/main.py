from __future__ import annotations

import logging

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.routers import photos, metadata, upload, settings

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(
    title="Stock Photos Uploader",
    description="Batch-analyze photos with AI and upload to Adobe Stock & Shutterstock",
    version="1.0.0",
)

app.include_router(photos.router)
app.include_router(metadata.router)
app.include_router(upload.router)
app.include_router(settings.router)


@app.middleware("http")
async def no_cache_for_dynamic(request: Request, call_next):
    """Stop Chrome's heuristic cache from serving a stale photo list or HTML.

    Static assets under /static/ are version-busted via ``?v=N`` query strings
    so they can stay cacheable; everything else (HTML shell + JSON API) must
    revalidate on every refresh.
    """
    response = await call_next(request)
    path = request.url.path
    if not path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    return FileResponse(
        "static/index.html",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )

from __future__ import annotations

import logging

from dotenv import load_dotenv
from fastapi import FastAPI
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

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    return FileResponse("static/index.html")

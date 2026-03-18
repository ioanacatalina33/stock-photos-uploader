# Stock Photos Uploader

Batch-analyze photos with AI and upload to **Adobe Stock** and **Shutterstock** with platform-specific metadata.

## What It Does

1. **Import photos** -- drag-and-drop or browse for JPEG/PNG/TIFF files
2. **AI analysis** -- GPT-4o Vision analyzes each photo and generates:
   - Title (max 70 chars, optimized for stock search)
   - Description (max 200 chars)
   - Up to 50 keywords ordered by relevance
   - Adobe Stock category (numbered 1-21)
   - Shutterstock categories (from their fixed list)
   - Editorial and mature content flags
3. **Review and edit** -- tweak any generated metadata before uploading
4. **Embed metadata** -- write IPTC/XMP data directly into image files
5. **Generate CSVs** -- download platform-specific CSV metadata files
6. **Upload** -- send photos + CSV via SFTP to Adobe Stock and FTPS to Shutterstock

## Prerequisites

- **Python 3.10+**
- **ExifTool** (for metadata embedding into image files)
- **OpenAI API key** (for GPT-4o Vision photo analysis)

### Install ExifTool

```bash
# macOS
brew install exiftool

# Ubuntu/Debian
sudo apt install libimage-exiftool-perl

# Windows -- download from https://exiftool.org
```

## Setup

```bash
# Clone the repo
git clone https://github.com/ioanacatalina33/stock-photos-uploader.git
cd stock-photos-uploader

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set your OpenAI API key (or configure via the Settings page)
cp .env.example .env
# Edit .env and add your key
```

## Running

```bash
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open http://localhost:8000 in your browser.

## Configuration

Go to the **Settings** tab in the web UI to configure:

### OpenAI API Key
Required for AI photo analysis. Get one at https://platform.openai.com/api-keys

### Adobe Stock SFTP Credentials
1. Log into [Adobe Stock Contributor Portal](https://contributor.stock.adobe.com)
2. Go to Upload > click "Learn More" for SFTP
3. Click "Generate Password"
4. Enter the host, username, and password in Settings

### Shutterstock FTPS Credentials
1. Log into [Shutterstock Contributor Portal](https://submit.shutterstock.com)
2. Find your FTPS upload credentials in the upload settings
3. Enter the host, username, and password in Settings

## Workflow

1. **Upload photos** -- drag files into the drop zone
2. **Click "Analyze All with AI"** -- each photo is sent to GPT-4o Vision
3. **Review metadata** -- click any photo to open the editor panel; adjust titles, keywords, and categories
4. **Embed metadata** -- click "Embed Metadata" to write IPTC/XMP data into the files (requires ExifTool)
5. **Upload** -- click "Upload Adobe", "Upload Shutterstock", or "Upload Both"
6. **Or download CSVs** -- use "CSV Adobe" / "CSV Shutterstock" buttons for manual upload

## How Metadata Reaches Each Platform

### Adobe Stock
- Photos uploaded via SFTP to `sftp.contributor.adobestock.com`
- CSV file uploaded with columns: `Filename, Title, Keywords, Category, Releases`
- IPTC/XMP metadata embedded in image files is also read by Adobe

### Shutterstock
- Photos uploaded via FTPS to `ftps.shutterstock.com`
- CSV file uploaded with columns: `Filename, Description, Keywords, Categories, Editorial, R-rated`
- IPTC/XMP metadata embedded in image files is also read by Shutterstock

## Tech Stack

- **FastAPI** -- Python web framework
- **OpenAI GPT-4o** -- Vision API for photo analysis
- **ExifTool** -- IPTC/XMP metadata embedding
- **Paramiko** -- SFTP client for Adobe Stock
- **ftplib** -- FTPS client for Shutterstock
- **Pillow** -- Image processing

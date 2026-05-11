# VetIOS Google Drive Dataset Workflow

Use this in Colab after you have access to the shared Drive folders.

The goal is to separate three kinds of material:

- structured case exports that can become supervised fine-tuning rows
- reference documents that belong in RAG/evidence ingestion, not SFT labels
- files with possible PHI/identifiers that must be reviewed before any training

## Option A: Download Public Folders

```bash
pip install -U gdown pypdf openpyxl

mkdir -p /content/vetios_drive/folder_1 /content/vetios_drive/folder_2 /content/vetios_drive/folder_3

gdown --folder "https://drive.google.com/drive/folders/1ZiDgdB7_xnoYjwtddy8eJn0-pkuM5GJC?usp=drive_link" -O /content/vetios_drive/folder_1
gdown --folder "https://drive.google.com/drive/folders/1aAR35jLNOs1EogZvw7tgBcPPXAIITvFl?usp=drive_link" -O /content/vetios_drive/folder_2
gdown --folder "https://drive.google.com/drive/folders/0B_KDAXN2DwKNflhVWmFBX0tmWDZtMXNnaFVLNkF6RGNxdDlGM21zdXhONnJEVVRrdnh0c28?resourcekey=0-9UNgZtFMOxkfoXElpBB6gQ&usp=drive_link" -O /content/vetios_drive/folder_3
```

If `gdown` cannot access the folders, use Option B.

## Option B: Mount Drive

```python
from google.colab import drive
drive.mount("/content/drive")
```

If the folders are under Shared with me, add shortcuts to your My Drive first, then use the mounted shortcut paths.

## Audit And Import

Run this against downloaded or mounted folders:

```bash
python vetios_pipeline/ingest_drive_sources.py \
  --root /content/vetios_drive/folder_1 \
  --root /content/vetios_drive/folder_2 \
  --root /content/vetios_drive/folder_3 \
  --output-dir vetios_pipeline/datasets/drive_audit \
  --clinical-output vetios_pipeline/datasets/clinical_cases.jsonl \
  --usage-class internal_deidentified \
  --review-status clinician_reviewed \
  --strict-dates \
  --generate-case-id \
  --skip-unlabeled
```

For the RAG knowledge base, prefer the rebuild wrapper because it runs ingestion and validates the expected audit/chunk artifacts in one pass:

```bash
python vetios_pipeline/rebuild_rag_knowledge_base.py \
  --root /content/vetios_drive/folder_1 \
  --root /content/vetios_drive/folder_2 \
  --root /content/vetios_drive/folder_3 \
  --output-dir vetios_pipeline/datasets/drive_audit \
  --clinical-output vetios_pipeline/datasets/clinical_cases.jsonl \
  --usage-class internal_deidentified \
  --review-status clinician_reviewed \
  --strict-dates \
  --generate-case-id \
  --skip-unlabeled
```

Outputs:

- `vetios_pipeline/datasets/drive_audit/drive_inventory.json`
- `vetios_pipeline/datasets/drive_audit/source_document_chunks.jsonl`
- `vetios_pipeline/datasets/drive_audit/rag_rebuild_summary.json`
- `vetios_pipeline/datasets/clinical_cases.jsonl` if structured case exports were found

The script imports CSV, JSONL, and XLSX files only when they look like clinical case rows with labels. PDFs, DOCX, PPTX, TXT, and Markdown are inventoried/chunked for reference/RAG use, not automatically used as supervised labels.

## Inspect The Audit

```bash
python - <<'PY'
import json
from collections import Counter

inventory = json.load(open("vetios_pipeline/datasets/drive_audit/drive_inventory.json"))
print(Counter((item["kind"], item["status"]) for item in inventory))
for item in inventory[:20]:
    print(item["status"], item["path"])
PY
```

If files are flagged as `flagged_possible_phi`, review and de-identify them before training.

## Prepare Training Rows

```bash
python vetios_pipeline/prepare_dataset.py \
  --input vetios_pipeline/datasets/clinical_cases.jsonl \
  --output-dir vetios_pipeline/datasets/prepared \
  --holdout 0.1 \
  --strict-dates
```

The manifest should show more than one row. A useful first target is at least `300` train rows and `50` eval rows.

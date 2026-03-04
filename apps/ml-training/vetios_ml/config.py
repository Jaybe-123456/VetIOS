"""Centralized configuration loaded from environment variables."""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ── Supabase ──────────────────────────────────────────────────────────────────
SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# ── Training hyperparameters ──────────────────────────────────────────────────
BATCH_SIZE: int = int(os.getenv("TRAINING_BATCH_SIZE", "32"))
EPOCHS: int = int(os.getenv("TRAINING_EPOCHS", "50"))
LEARNING_RATE: float = float(os.getenv("TRAINING_LEARNING_RATE", "0.001"))

# ── Paths ─────────────────────────────────────────────────────────────────────
ARTIFACTS_DIR: Path = Path(os.getenv("MODEL_ARTIFACTS_DIR", "./artifacts"))
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

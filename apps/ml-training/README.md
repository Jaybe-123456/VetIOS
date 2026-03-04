# VetIOS ML Training Pipeline

Production-grade TensorFlow training pipeline for veterinary clinical intelligence.

## Quick Start

```bash
cd apps/ml-training
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -e ".[dev]"

# Configure Supabase connection
cp .env.example .env
# Edit .env with your Supabase credentials

# Extract training dataset
python -m vetios_ml.data.dataset_builder

# Train baseline model
python -m vetios_ml.train

# Evaluate model
python -m vetios_ml.evaluate

# Register model version
python -m vetios_ml.register_model

# Start inference server
python -m vetios_ml.serve
```

## Architecture

```
apps/ml-training/
├── vetios_ml/
│   ├── data/              # Dataset extraction from Supabase
│   │   ├── dataset_builder.py
│   │   └── feature_views.py
│   ├── models/            # TensorFlow model definitions
│   │   └── risk_model.py
│   ├── train.py           # Custom tf.GradientTape training loop
│   ├── evaluate.py        # AUROC, ECE, Brier scoring
│   ├── register_model.py  # Model versioning + Supabase logging
│   └── serve.py           # FastAPI inference endpoint
├── artifacts/             # Saved model checkpoints
├── pyproject.toml
└── .env.example
```

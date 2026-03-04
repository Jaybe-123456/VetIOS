"""
serve.py — FastAPI inference server for the VetIOS risk model.

Usage:
    python -m vetios_ml.serve

Starts a FastAPI server at http://localhost:8000 with:
  POST /predict   — Run risk inference
  GET  /health    — Health check
  GET  /model     — Model metadata
"""

import json
import numpy as np
import tensorflow as tf
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager

from vetios_ml.config import ARTIFACTS_DIR


# ── Global model reference ────────────────────────────────────────────────────
_model = None
_model_meta = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the model on startup."""
    global _model, _model_meta

    model_path = ARTIFACTS_DIR / "risk_model_v1.weights.h5"
    meta_path = ARTIFACTS_DIR / "training_metrics.json"

    if meta_path.exists():
        with open(meta_path) as f:
            _model_meta = json.load(f)

    if model_path.exists() and _model_meta:
        import numpy as np
        from vetios_ml.models.risk_model import VetRiskModel
        _model = VetRiskModel(input_dim=_model_meta["input_dim"])
        _model(np.zeros((1, _model_meta["input_dim"]), dtype=np.float32))
        _model.load_weights(model_path)
        print(f"[serve] Model loaded from {model_path}")
    else:
        print(f"[serve] WARNING: No model at {model_path}. /predict will return errors.")

    if meta_path.exists():
        with open(meta_path) as f:
            _model_meta = json.load(f)

    yield

    # Cleanup
    _model = None


app = FastAPI(
    title="VetIOS ML Inference",
    version="1.0.0",
    description="Clinical risk inference API powered by TensorFlow Autograd.",
    lifespan=lifespan,
)


# ── Request/Response schemas ──────────────────────────────────────────────────

class PredictRequest(BaseModel):
    """Input features for risk prediction."""
    decision_count: int = 0
    override_count: int = 0
    species: str = "canine"


class PredictResponse(BaseModel):
    """Risk prediction output."""
    risk_score: float
    confidence: float
    abstain: bool
    model_version: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "model_loaded": _model is not None,
    }


@app.get("/model")
async def model_info():
    """Return model metadata."""
    if _model_meta is None:
        raise HTTPException(status_code=404, detail="No model metadata available.")
    return {
        "input_dim": _model_meta.get("input_dim"),
        "feature_cols": _model_meta.get("feature_cols"),
        "final_loss": _model_meta.get("final_loss"),
        "final_accuracy": _model_meta.get("final_accuracy"),
        "epochs": _model_meta.get("epochs_completed"),
    }


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    """
    Run risk inference on a single case.

    Returns a calibrated risk score, confidence level,
    and whether the model abstains (low confidence).
    """
    if _model is None:
        raise HTTPException(status_code=503, detail="Model not loaded. Train first.")

    # Build feature vector (must match training feature order)
    # One-hot encode species to match build_tf_dataset encoding
    species_options = ["avian", "canine", "equine", "feline"]
    species_encoded = [1.0 if req.species == s else 0.0 for s in species_options]

    features = np.array(
        [[float(req.decision_count), float(req.override_count)] + species_encoded],
        dtype=np.float32,
    )

    logits = _model(features, training=False)
    risk_score = float(tf.nn.sigmoid(logits).numpy()[0][0])

    # Confidence = distance from 0.5 (higher = more confident)
    confidence = abs(risk_score - 0.5) * 2.0

    # Abstain if confidence is below threshold
    abstain = confidence < 0.3

    model_version = _model_meta.get("model_path", "unknown") if _model_meta else "unknown"

    return PredictResponse(
        risk_score=round(risk_score, 4),
        confidence=round(confidence, 4),
        abstain=abstain,
        model_version=model_version,
    )


# ── CLI entrypoint ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("VetIOS ML Inference Server")
    print("=" * 60)
    uvicorn.run("vetios_ml.serve:app", host="0.0.0.0", port=8000, reload=True)

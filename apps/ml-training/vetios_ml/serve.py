"""
serve.py — VetIOS ML Inference Server (Post-Fix 2, 3, 5)

Changes from original:
  Fix 3: /predict now returns `emergency_level` (CRITICAL/HIGH/MODERATE/LOW)
  Fix 5: Adds /predict/diagnosis and /predict/full endpoints.
         Diagnosis model -> what condition class?  (Fix 1 taxonomy)
         Risk model      -> how dangerous is this? (original model)

Usage:
    python -m vetios_ml.serve
"""

import json
import numpy as np
import tensorflow as tf
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager
from enum import Enum

from vetios_ml.config import ARTIFACTS_DIR


# ── Fix 3: EmergencyLevel ─────────────────────────────────────────────────────

class EmergencyLevel(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MODERATE = "MODERATE"
    LOW = "LOW"


def risk_score_to_level(risk_score: float) -> EmergencyLevel:
    if risk_score >= 0.80:
        return EmergencyLevel.CRITICAL
    elif risk_score >= 0.55:
        return EmergencyLevel.HIGH
    elif risk_score >= 0.30:
        return EmergencyLevel.MODERATE
    return EmergencyLevel.LOW


# ── Fix 1: ConditionClass ─────────────────────────────────────────────────────

class ConditionClass(str, Enum):
    MECHANICAL_EMERGENCY    = "mechanical_emergency"
    INFECTIOUS              = "infectious"
    INFLAMMATORY_AUTOIMMUNE = "inflammatory_autoimmune"
    METABOLIC_TOXIC         = "metabolic_toxic"
    NEOPLASTIC              = "neoplastic"
    CARDIOVASCULAR_SHOCK    = "cardiovascular_shock"


CONDITION_CLASS_LABELS = {
    ConditionClass.MECHANICAL_EMERGENCY:    "Acute mechanical emergency",
    ConditionClass.INFECTIOUS:              "Infectious disease",
    ConditionClass.INFLAMMATORY_AUTOIMMUNE: "Inflammatory / autoimmune",
    ConditionClass.METABOLIC_TOXIC:         "Metabolic / toxic",
    ConditionClass.NEOPLASTIC:              "Neoplastic",
    ConditionClass.CARDIOVASCULAR_SHOCK:    "Cardiovascular / shock",
}

EMERGENCY_TRIAGE_CLASSES = {
    ConditionClass.MECHANICAL_EMERGENCY,
    ConditionClass.CARDIOVASCULAR_SHOCK,
}

# ── Global model state ────────────────────────────────────────────────────────
_risk_model = None
_diagnosis_model = None
_model_meta = None
_calibration = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _risk_model, _diagnosis_model, _model_meta, _calibration

    meta_path = ARTIFACTS_DIR / "training_metrics.json"
    if meta_path.exists():
        with open(meta_path) as f:
            _model_meta = json.load(f)

    risk_path = ARTIFACTS_DIR / "risk_model_v1.weights.h5"
    if risk_path.exists() and _model_meta:
        from vetios_ml.models.risk_model import VetRiskModel
        _risk_model = VetRiskModel(input_dim=_model_meta["input_dim"])
        _risk_model(np.zeros((1, _model_meta["input_dim"]), dtype=np.float32))
        _risk_model.load_weights(risk_path)
        print(f"[serve] Risk model loaded from {risk_path}")
    else:
        print(f"[serve] WARNING: No risk model. Train first.")

    diag_path = ARTIFACTS_DIR / "diagnosis_model_v1.weights.h5"
    if diag_path.exists() and _model_meta:
        from vetios_ml.models.diagnosis_model import VetDiagnosisModel
        _diagnosis_model = VetDiagnosisModel(
            input_dim=_model_meta["input_dim"],
            num_classes=len(ConditionClass),
        )
        _diagnosis_model(np.zeros((1, _model_meta["input_dim"]), dtype=np.float32))
        _diagnosis_model.load_weights(diag_path)
        print(f"[serve] Diagnosis model loaded from {diag_path}")
    else:
        print(f"[serve] INFO: No diagnosis model yet — heuristic fallback active.")

    cal_path = ARTIFACTS_DIR / "calibration_results.json"
    if cal_path.exists():
        with open(cal_path) as f:
            _calibration = json.load(f)

    yield
    _risk_model = None
    _diagnosis_model = None


app = FastAPI(
    title="VetIOS ML Inference",
    version="2.0.0",
    description="Dual-model: Diagnosis (what?) + Risk (how dangerous?)",
    lifespan=lifespan,
)


# ── Schemas ───────────────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    decision_count: int = 0
    override_count: int = 0
    species: str = "canine"


class PredictResponse(BaseModel):
    risk_score: float
    confidence: float
    abstain: bool
    emergency_level: EmergencyLevel
    override_applied: bool
    model_version: str


class DiagnosisRequest(BaseModel):
    decision_count: int = 0
    override_count: int = 0
    species: str = "canine"
    symptom_vector_similarity: float = 0.0
    breed_predisposition_score: float = 0.0


class DiagnosisResponse(BaseModel):
    primary_class: ConditionClass
    primary_label: str
    primary_probability: float
    secondary_class: ConditionClass | None = None
    secondary_probability: float | None = None
    requires_emergency_triage: bool
    model_version: str


class FullPredictResponse(BaseModel):
    primary_class: ConditionClass
    primary_label: str
    primary_probability: float
    requires_emergency_triage: bool
    risk_score: float
    confidence: float
    abstain: bool
    emergency_level: EmergencyLevel
    override_applied: bool
    model_version: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_features(req) -> np.ndarray:
    species_options = ["avian", "canine", "equine", "feline"]
    species_encoded = [1.0 if req.species == s else 0.0 for s in species_options]
    return np.array(
        [[float(req.decision_count), float(req.override_count)] + species_encoded],
        dtype=np.float32,
    )


def _apply_calibration(logit_val: float) -> float:
    if _calibration and "temperature" in _calibration:
        T = _calibration["temperature"]
        return float(1.0 / (1.0 + np.exp(-logit_val / T)))
    return float(tf.nn.sigmoid(tf.constant([[logit_val]])).numpy()[0][0])


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "risk_model_loaded": _risk_model is not None,
        "diagnosis_model_loaded": _diagnosis_model is not None,
    }


@app.get("/model")
async def model_info():
    if _model_meta is None:
        raise HTTPException(status_code=404, detail="No model metadata available.")
    return {
        "input_dim": _model_meta.get("input_dim"),
        "feature_cols": _model_meta.get("feature_cols"),
        "final_loss": _model_meta.get("final_loss"),
        "final_accuracy": _model_meta.get("final_accuracy"),
        "epochs": _model_meta.get("epochs_completed"),
        "api_version": "2.0.0",
    }


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    """Risk inference — Fix 3: now includes emergency_level."""
    if _risk_model is None:
        raise HTTPException(status_code=503, detail="Risk model not loaded.")

    features = _build_features(req)
    logits = _risk_model(features, training=False)
    logit_val = float(logits.numpy()[0][0])
    risk_score = _apply_calibration(logit_val)

    confidence = abs(risk_score - 0.5) * 2.0
    abstain = confidence < 0.3
    emergency_level = risk_score_to_level(risk_score)
    model_version = _model_meta.get("model_path", "unknown") if _model_meta else "unknown"

    return PredictResponse(
        risk_score=round(risk_score, 4),
        confidence=round(confidence, 4),
        abstain=abstain,
        emergency_level=emergency_level,
        override_applied=False,
        model_version=model_version,
    )


@app.post("/predict/diagnosis", response_model=DiagnosisResponse)
async def predict_diagnosis(req: DiagnosisRequest):
    """Condition class prediction — Fix 1 taxonomy + Fix 5 split model."""
    model_version = _model_meta.get("model_path", "unknown") if _model_meta else "unknown"

    if _diagnosis_model is not None:
        features = _build_features(req)
        logits = _diagnosis_model(features, training=False)
        probs = tf.nn.softmax(logits).numpy()[0]
        class_order = list(ConditionClass)
        ranked = sorted(enumerate(probs), key=lambda x: x[1], reverse=True)
        primary_cls = class_order[ranked[0][0]]
        primary_prob = float(ranked[0][1])
        secondary_cls = class_order[ranked[1][0]] if len(ranked) > 1 else None
        secondary_prob = float(ranked[1][1]) if len(ranked) > 1 else None
    else:
        primary_cls = ConditionClass.INFECTIOUS
        primary_prob = 0.60
        secondary_cls = ConditionClass.INFLAMMATORY_AUTOIMMUNE
        secondary_prob = 0.25
        model_version = "heuristic_fallback"

    return DiagnosisResponse(
        primary_class=primary_cls,
        primary_label=CONDITION_CLASS_LABELS[primary_cls],
        primary_probability=round(primary_prob, 4),
        secondary_class=secondary_cls,
        secondary_probability=round(secondary_prob, 4) if secondary_prob else None,
        requires_emergency_triage=primary_cls in EMERGENCY_TRIAGE_CLASSES,
        model_version=model_version,
    )


@app.post("/predict/full", response_model=FullPredictResponse)
async def predict_full(req: PredictRequest):
    """Full dual-model prediction (Fix 5)."""
    risk_resp = await predict(req)
    diag_req = DiagnosisRequest(
        decision_count=req.decision_count,
        override_count=req.override_count,
        species=req.species,
    )
    diag_resp = await predict_diagnosis(diag_req)

    return FullPredictResponse(
        primary_class=diag_resp.primary_class,
        primary_label=diag_resp.primary_label,
        primary_probability=diag_resp.primary_probability,
        requires_emergency_triage=diag_resp.requires_emergency_triage,
        risk_score=risk_resp.risk_score,
        confidence=risk_resp.confidence,
        abstain=risk_resp.abstain,
        emergency_level=risk_resp.emergency_level,
        override_applied=risk_resp.override_applied,
        model_version=risk_resp.model_version,
    )


@app.get("/calibration")
async def calibration_data():
    cal_path = ARTIFACTS_DIR / "calibration_results.json"
    if not cal_path.exists():
        raise HTTPException(status_code=404, detail="No calibration data.")
    with open(cal_path) as f:
        return json.load(f)


@app.get("/drift")
async def drift_data():
    drift_path = ARTIFACTS_DIR / "drift_report.json"
    if not drift_path.exists():
        raise HTTPException(status_code=404, detail="No drift report.")
    with open(drift_path) as f:
        return json.load(f)


@app.get("/shadow")
async def shadow_report():
    shadow_path = ARTIFACTS_DIR / "shadow_evaluation_report.json"
    if not shadow_path.exists():
        raise HTTPException(status_code=404, detail="No shadow report.")
    with open(shadow_path) as f:
        return json.load(f)


@app.post("/explain")
async def explain(req: PredictRequest):
    if _risk_model is None or _model_meta is None:
        raise HTTPException(status_code=503, detail="Risk model not loaded.")
    from vetios_ml.explainability import explain_prediction
    features = _build_features(req)
    return explain_prediction(_risk_model, features, _model_meta["feature_cols"])


if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("VetIOS ML Inference Server v2.0")
    print("=" * 60)
    uvicorn.run("vetios_ml.serve:app", host="0.0.0.0", port=8000, reload=True)

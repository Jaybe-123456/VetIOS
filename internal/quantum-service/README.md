# VetIOS Quantum Service

FastAPI service for optional quantum-adjacent workloads:

- `POST /rank`: anonymized graph ranking for GBS-compatible maximum weighted clique experiments.
- `POST /amr/screen`: AMR sequence screening with local CARD marker subset and PennyLane novelty scoring.

The inference API only sends anonymized graph node IDs and weights to `/rank`.
No patient data, species, symptoms, or clinical text is sent to the ranker.

Run locally:

```bash
cd internal/quantum-service
python -m pip install -r requirements.txt
python -m uvicorn main:app --port 8001 --reload
```

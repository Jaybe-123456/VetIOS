# VetIOS ML Server — Deployment Guide

## Recommended Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Vercel      │────▶│ ML Server        │────▶│ Supabase        │
│   (Next.js)   │     │ (FastAPI + TF)   │     │ (PostgreSQL)    │
│   Port: 443   │     │ Port: 8000       │     │ Port: 5432      │
└──────────────┘     └──────────────────┘     └─────────────────┘
```

**Vercel**: Web app + API orchestration (lightweight)
**ML Server**: FastAPI + TensorFlow inference (dedicated runtime)
**Supabase**: Auth, RLS, event tables

---

## Option 1: Railway (Recommended — Simplest)

### Deploy
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Init project
cd apps/ml-training
railway init

# Deploy
railway up

# Get the URL
railway domain
```

### Set environment
```bash
railway variables set SUPABASE_URL=https://yluxqcbjtvnxtrvazrwn.supabase.co
railway variables set SUPABASE_SERVICE_ROLE_KEY=<your-key>
```

### Connect from Vercel
Set `ML_SERVER_URL` in Vercel env vars to the Railway URL.

---

## Option 2: Google Cloud Run

### Dockerfile
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system deps for TensorFlow
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --no-cache-dir ".[all]"

COPY . .

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "vetios_ml.serve:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Deploy
```bash
cd apps/ml-training

# Build and push
gcloud builds submit --tag gcr.io/YOUR_PROJECT/vetios-ml

# Deploy
gcloud run deploy vetios-ml \
  --image gcr.io/YOUR_PROJECT/vetios-ml \
  --platform managed \
  --region us-central1 \
  --memory 2Gi \
  --cpu 2 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars SUPABASE_URL=https://yluxqcbjtvnxtrvazrwn.supabase.co,SUPABASE_SERVICE_ROLE_KEY=<key>
```

---

## Option 3: Render

### render.yaml
```yaml
services:
  - type: web
    name: vetios-ml
    runtime: python
    buildCommand: pip install ".[all]"
    startCommand: python -m uvicorn vetios_ml.serve:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: SUPABASE_URL
        value: https://yluxqcbjtvnxtrvazrwn.supabase.co
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
    plan: starter
```

---

## Health Check

After deploying, verify the ML server is accessible:

```bash
# From your machine
curl https://your-ml-server-url/health

# Expected response:
# {"status": "ok", "model_loaded": true}

# Then verify from Vercel by checking:
curl https://your-vercel-app.vercel.app/api/ml/predict
# Should show: {"ml_server_reachable": true, ...}
```

## Update Vercel

After deploying the ML server, set `ML_SERVER_URL` in Vercel:

```
Vercel Dashboard → Project → Settings → Environment Variables

Key:   ML_SERVER_URL
Value: https://your-ml-server-url.railway.app  (or Cloud Run URL)
Scope: Production
```

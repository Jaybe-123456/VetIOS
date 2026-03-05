FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl && \
    rm -rf /var/lib/apt/lists/*

# Copy everything first (source needed for install)
COPY . .

# Install Python deps (non-editable — works properly in Docker)
RUN pip install --no-cache-dir .

# Create artifacts dir for model weights
RUN mkdir -p /app/artifacts

# Railway sets PORT dynamically
ENV PORT=8000
EXPOSE 8000

# Train model if needed, then serve
CMD python -m vetios_ml.startup && exec uvicorn vetios_ml.serve:app --host 0.0.0.0 --port $PORT

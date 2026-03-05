FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl && \
    rm -rf /var/lib/apt/lists/*

# Copy source
COPY . .

# Install Python deps
RUN pip install --no-cache-dir .

# Create artifacts dir and train model DURING build
# This bakes the trained model into the image so the container starts instantly
RUN mkdir -p /app/artifacts && python -m vetios_ml.startup

# Railway sets PORT dynamically
ENV PORT=8000
EXPOSE 8000

# Start serving immediately (model already trained)
CMD exec uvicorn vetios_ml.serve:app --host 0.0.0.0 --port $PORT

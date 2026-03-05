FROM python:3.11-slim

WORKDIR /app

# System deps for TensorFlow
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY pyproject.toml ./
RUN pip install --no-cache-dir -e "."

# Copy app code
COPY . .

# Create artifacts dir
RUN mkdir -p /app/artifacts

# Expose port
EXPOSE 8000

# Train model on startup if weights don't exist, then serve
CMD ["sh", "-c", "python -m vetios_ml.startup && python -m uvicorn vetios_ml.serve:app --host 0.0.0.0 --port ${PORT:-8000}"]

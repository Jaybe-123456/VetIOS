"""VetIOS ML training pipeline package."""

import os

# Render deploys this service on CPU instances, so disable GPU probing and
# reduce TensorFlow startup noise across both training and serving paths.
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

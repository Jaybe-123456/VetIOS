"""
VetIOS Risk Model — baseline clinical risk scorer using tf.GradientTape.

This model predicts:
  - Adverse outcome probability (binary risk)
  - Calibrated confidence score

Architecture: Dense MLP with dropout + safety-penalty-aware loss.
"""

import tensorflow as tf


class VetRiskModel(tf.keras.Model):
    """
    Multi-layer risk scorer for clinical encounter triage.

    Inputs: Numeric feature vector (encounter features, decision counts, etc.)
    Output: Single logit for binary adverse-outcome prediction.
    """

    def __init__(self, input_dim: int, dropout_rate: float = 0.3):
        super().__init__()
        self.net = tf.keras.Sequential([
            tf.keras.layers.InputLayer(shape=(input_dim,)),
            tf.keras.layers.Dense(128, activation="relu"),
            tf.keras.layers.BatchNormalization(),
            tf.keras.layers.Dropout(dropout_rate),
            tf.keras.layers.Dense(64, activation="relu"),
            tf.keras.layers.BatchNormalization(),
            tf.keras.layers.Dropout(dropout_rate),
            tf.keras.layers.Dense(32, activation="relu"),
            tf.keras.layers.Dense(1),  # Raw logit — apply sigmoid at inference
        ])

    def call(self, x, training=False):
        return self.net(x, training=training)

    def predict_proba(self, x):
        """Return calibrated probability (sigmoid of logit)."""
        logits = self(x, training=False)
        return tf.nn.sigmoid(logits)


class SafetyPenalizedLoss(tf.keras.losses.Loss):
    """
    Binary cross-entropy + safety penalty for confident predictions
    on cases with high override counts (indicating clinician disagreement).

    total_loss = BCE + lambda_safety * mean(override_weight * pred^2)
    """

    def __init__(self, lambda_safety: float = 0.5, **kwargs):
        super().__init__(**kwargs)
        self.lambda_safety = lambda_safety
        self.bce = tf.keras.losses.BinaryCrossentropy(from_logits=True)

    def call(self, y_true, y_pred):
        task_loss = self.bce(y_true, y_pred)
        # Safety penalty: penalize overconfident predictions
        pred_proba = tf.nn.sigmoid(y_pred)
        safety_penalty = tf.reduce_mean(tf.square(pred_proba) * tf.cast(y_true, tf.float32))
        return task_loss + self.lambda_safety * safety_penalty

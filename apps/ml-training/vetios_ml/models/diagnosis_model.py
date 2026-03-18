"""
VetIOS Diagnosis Model — Fix 5 (separate diagnosis model).

Predicts the PRIMARY CONDITION CLASS from clinical features.
This is the "what disease class is this?" model, completely separate
from VetRiskModel which answers "how dangerous is this case?".

Output: softmax over N condition classes (Fix 1 taxonomy).
"""

import tensorflow as tf


class VetDiagnosisModel(tf.keras.Model):
    """
    Multi-class condition classifier.

    Inputs: same feature vector as VetRiskModel (compatible).
    Output: softmax over num_classes condition classes (Fix 1 taxonomy).

    Classes (in order):
      0 - mechanical_emergency
      1 - infectious
      2 - inflammatory_autoimmune
      3 - metabolic_toxic
      4 - neoplastic
      5 - cardiovascular_shock
    """

    def __init__(self, input_dim: int, num_classes: int = 6, dropout_rate: float = 0.3):
        super().__init__()
        self.num_classes = num_classes
        self.net = tf.keras.Sequential([
            tf.keras.layers.InputLayer(input_shape=(input_dim,)),
            tf.keras.layers.Dense(128, activation="relu"),
            tf.keras.layers.BatchNormalization(),
            tf.keras.layers.Dropout(dropout_rate),
            tf.keras.layers.Dense(64, activation="relu"),
            tf.keras.layers.BatchNormalization(),
            tf.keras.layers.Dropout(dropout_rate),
            tf.keras.layers.Dense(32, activation="relu"),
            tf.keras.layers.Dense(num_classes),  # Raw logits — apply softmax at inference
        ])

    def call(self, x, training=False):
        return self.net(x, training=training)

    def predict_proba(self, x):
        """Return class probability distribution (softmax of logits)."""
        logits = self(x, training=False)
        return tf.nn.softmax(logits)

    def predict_class(self, x):
        """Return the argmax class index."""
        probs = self.predict_proba(x)
        return tf.argmax(probs, axis=-1)


class DiagnosisFocalLoss(tf.keras.losses.Loss):
    """
    Focal loss for multi-class diagnosis.

    Addresses class imbalance — mechanical emergencies (GDV, torsion) are
    rare but high-stakes. Focal loss down-weights easy examples and focuses
    training on hard or rare cases.

    total_loss = -alpha_t * (1 - p_t)^gamma * log(p_t)
    """

    def __init__(self, gamma: float = 2.0, **kwargs):
        super().__init__(**kwargs)
        self.gamma = gamma
        self.cce = tf.keras.losses.CategoricalCrossentropy(from_logits=True, reduction='none')

    def call(self, y_true, y_pred):
        ce_loss = self.cce(y_true, y_pred)
        p_t = tf.reduce_sum(tf.nn.softmax(y_pred) * y_true, axis=-1)
        focal_weight = tf.pow(1.0 - p_t, self.gamma)
        return tf.reduce_mean(focal_weight * ce_loss)

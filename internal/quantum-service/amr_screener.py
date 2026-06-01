import hashlib
import math
import time

import numpy as np


KNOWN_AMR_GENES = {
    "blaCTX-M-15": {"class": "beta_lactam", "markers": ["BLACTXM15", "CTXM15", "ATGGTTAAAAAATCACTGCG"]},
    "mcr-1": {"class": "colistin", "markers": ["MCR1", "ATGATGCAGCATACTTCTGT"]},
    "mecA": {"class": "methicillin", "markers": ["MECA", "ATGAAAAAGATAAAAATTGTTCC"]},
    "vanA": {"class": "vancomycin", "markers": ["VANA", "ATGAATAGAATAAAAGTTGC"]},
    "tetA": {"class": "tetracycline", "markers": ["TETA", "ATGAAATTGCTTAACACCGG"]},
    "sul1": {"class": "sulfonamide", "markers": ["SUL1", "ATGGTGACGGTGTTCGGCAT"]},
}


def screen_sequence(sequence, species):
    start = time.time()
    normalized = normalize_fasta(sequence)
    found_genes = screen_for_known_genes(normalized, sequence)
    classes = sorted({KNOWN_AMR_GENES[gene]["class"] for gene in found_genes})
    features = featurize_sequence(normalized)
    novelty = compute_quantum_novelty_score(features)

    return {
        "sequence_hash": hashlib.sha256(normalized.encode("utf-8")).hexdigest(),
        "resistance_genes": found_genes,
        "resistance_classes": classes,
        "novel_pattern_score": novelty,
        "quantum_backend": "default.qubit",
        "card_db_version": "local-marker-v1",
        "latency_ms": int((time.time() - start) * 1000),
    }


def normalize_fasta(sequence):
    lines = []
    for line in sequence.upper().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(">"):
            continue
        lines.append("".join(ch for ch in stripped if ch in "ATCGN"))
    normalized = "".join(lines)
    if not normalized:
        normalized = "".join(ch for ch in sequence.upper() if ch in "ATCGN")
    return normalized


def screen_for_known_genes(normalized_sequence, raw_sequence):
    raw_upper = raw_sequence.upper()
    found = []
    for gene, meta in KNOWN_AMR_GENES.items():
        for marker in meta["markers"]:
            if marker in normalized_sequence or marker in raw_upper:
                found.append(gene)
                break
    return found


def featurize_sequence(sequence):
    bases = {"A": 0, "T": 1, "C": 2, "G": 3}
    freqs = np.zeros(256)
    for i in range(max(0, len(sequence) - 3)):
        kmer = sequence[i:i + 4]
        if len(kmer) != 4 or any(base not in bases for base in kmer):
            continue
        idx = sum(bases[base] * (4 ** pos) for pos, base in enumerate(kmer))
        freqs[idx] += 1
    total = float(freqs.sum())
    return freqs / total if total > 0 else freqs


def compute_quantum_novelty_score(features):
    try:
        import pennylane as qml

        reduced = reduce_features(features, 4)
        known = np.array([
            [0.2, 0.4, 0.6, 0.8],
            [0.8, 0.2, 0.4, 0.6],
            [0.5, 0.5, 0.3, 0.7],
            [0.1, 0.7, 0.2, 0.9],
        ])
        dev = qml.device("default.qubit", wires=4)

        @qml.qnode(dev)
        def kernel(x1, x2):
            qml.AngleEmbedding(x1, wires=range(4))
            qml.adjoint(qml.AngleEmbedding)(x2, wires=range(4))
            return qml.probs(wires=range(4))

        similarities = [float(kernel(reduced, pattern)[0]) for pattern in known]
        return float(np.clip(1.0 - np.mean(similarities), 0.0, 1.0))
    except Exception:
        entropy = shannon_entropy(features)
        return float(max(0.0, min(1.0, entropy / 8.0)))


def reduce_features(features, size):
    chunks = np.array_split(features, size)
    reduced = np.array([float(chunk.mean()) for chunk in chunks])
    max_value = float(np.max(reduced)) if reduced.size else 0.0
    return reduced / max_value if max_value > 0 else reduced


def shannon_entropy(features):
    positives = [value for value in features if value > 0]
    return -sum(value * math.log(value, 2) for value in positives)

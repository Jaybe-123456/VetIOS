"""
Weighted Full Stem Graph (WFSG) construction for RNA folding.

Based on Tang et al. (2023), as used by Yu et al. (2023).
DOI lineage: 10.1038/s43588-023-00526-y
"""

from dataclasses import dataclass
from typing import List, Set, Tuple

import numpy as np


VALID_PAIRS = {
    ("A", "U"),
    ("U", "A"),
    ("G", "C"),
    ("C", "G"),
    ("G", "U"),
    ("U", "G"),
}


@dataclass(frozen=True)
class Stem:
    id: int
    start5: int
    start3: int
    length: int
    weight: float


def find_all_stems(sequence: str, min_stem_length: int = 2) -> List[Stem]:
    seq = sequence.upper()
    stems: List[Stem] = []
    stem_id = 0

    for i in range(len(seq)):
        for j in range(len(seq) - 1, i + 3, -1):
            if (seq[i], seq[j]) not in VALID_PAIRS:
                continue

            length = 0
            while i + length < j - length and (seq[i + length], seq[j - length]) in VALID_PAIRS:
                length += 1

            if length >= min_stem_length:
                stems.append(
                    Stem(
                        id=stem_id,
                        start5=i,
                        start3=j,
                        length=length,
                        weight=float(length),
                    )
                )
                stem_id += 1

    unique: List[Stem] = []
    seen = set()
    for stem in stems:
        key = (stem.start5, stem.start3, stem.length)
        if key in seen:
            continue
        seen.add(key)
        unique.append(stem)

    return unique


def stems_can_coexist(stem_a: Stem, stem_b: Stem) -> bool:
    a_positions = _occupied_positions(stem_a)
    b_positions = _occupied_positions(stem_b)
    if a_positions & b_positions:
        return False

    a5, a3 = stem_a.start5, stem_a.start3
    b5, b3 = stem_b.start5, stem_b.start3

    if a5 < b5 < a3 < b3:
        return False
    if b5 < a5 < b3 < a3:
        return False

    return True


def build_wfsg(sequence: str, min_stem_length: int = 2, max_nodes: int = 35) -> Tuple[List[Stem], np.ndarray]:
    stems = find_all_stems(sequence, min_stem_length=min_stem_length)
    if not stems:
        raise ValueError(f"No stems of length >= {min_stem_length} found")

    if len(stems) > max_nodes:
        stems = sorted(stems, key=lambda stem: (stem.weight, stem.length), reverse=True)[:max_nodes]

    matrix = np.zeros((len(stems), len(stems)), dtype=float)
    for i, stem in enumerate(stems):
        matrix[i, i] = stem.weight
        for j in range(i + 1, len(stems)):
            if stems_can_coexist(stem, stems[j]):
                matrix[i, j] = 1.0
                matrix[j, i] = 1.0

    return stems, matrix


def mcc_score(predicted_pairs: Set[Tuple[int, int]], reference_pairs: Set[Tuple[int, int]], sequence_length: int) -> float:
    total_pairs = sequence_length * (sequence_length - 1) / 2
    tp = len(predicted_pairs & reference_pairs)
    fp = len(predicted_pairs - reference_pairs)
    fn = len(reference_pairs - predicted_pairs)
    tn = total_pairs - tp - fp - fn

    denominator = ((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn)) ** 0.5
    if denominator == 0:
        return 0.0
    return float((tp * tn - fp * fn) / denominator)


def _occupied_positions(stem: Stem) -> set:
    return set(range(stem.start5, stem.start5 + stem.length)) | set(
        range(stem.start3 - stem.length + 1, stem.start3 + 1)
    )

"""PennyLane/AWS Braket runner contract for VetIOS GBS experiments.

The TypeScript platform emits a manifest with the graph, matrices, backend
configuration, and exact classical baseline. This runner is intentionally kept
outside the Next.js build path; it is executed only by a configured research job.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class GbsRunResult:
    selected_node_ids: list[str]
    selected_labels: list[str]
    score: float
    backend: str
    method: str


def run_gbs_maximum_weighted_clique(manifest: dict[str, Any]) -> GbsRunResult:
    """Run the backend experiment entrypoint against the manifest graph.

    The TypeScript service keeps production traffic on the exact local baseline.
    This runner gives a research worker the same manifest contract from Python,
    after installing packages/quantum/python/requirements.txt, before swapping
    the scoring step to a PennyLane circuit for the configured Braket device.
    """

    problem = manifest["problem"]
    nodes = problem.get("nodes", [])
    if not nodes:
        return GbsRunResult([], [], 0.0, "pennylane_aws_braket", "exact_manifest_baseline")

    adjacency = manifest["matrices"]["adjacency"]
    edge_weights = manifest["matrices"]["edge_weights"]
    node_weights = manifest["matrices"]["node_weights"]
    best_indices: list[int] = []
    best_score = 0.0

    for mask in range(1, 2 ** len(nodes)):
        selected = [index for index in range(len(nodes)) if mask & (1 << index)]
        if not _is_clique(selected, adjacency):
            continue
        score = _score_clique(selected, node_weights, edge_weights)
        if score > best_score:
            best_score = score
            best_indices = selected

    selected_nodes = [nodes[index] for index in best_indices]
    return GbsRunResult(
        selected_node_ids=[str(node["id"]) for node in selected_nodes],
        selected_labels=[str(node["label"]) for node in selected_nodes],
        score=round(best_score, 3),
        backend="pennylane_aws_braket",
        method="exact_manifest_baseline",
    )


def _is_clique(indices: list[int], adjacency: list[list[int]]) -> bool:
    for left_pos, left in enumerate(indices):
        for right in indices[left_pos + 1:]:
            if adjacency[left][right] != 1:
                return False
    return True


def _score_clique(indices: list[int], node_weights: list[float], edge_weights: list[list[float]]) -> float:
    score = sum(float(node_weights[index]) for index in indices)
    for left_pos, left in enumerate(indices):
        for right in indices[left_pos + 1:]:
            score += float(edge_weights[left][right])
    return score

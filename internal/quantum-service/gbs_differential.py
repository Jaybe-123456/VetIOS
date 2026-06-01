"""
GBS-enhanced maximum weighted clique ranking.

Application 1 from the VetIOS GBS sprint. The public API accepts only
anonymised graph IDs and weights. It attempts Strawberry Fields sampling and
Banchi-style postprocessing when available, with a deterministic exact fallback
for small graphs and CI environments.
"""

from itertools import combinations
from random import Random
from time import time
from typing import Dict, List, Sequence, Tuple

import numpy as np

from big_constructor import rescale_for_gbs


PAPER_DOI = "10.1038/s43588-023-00526-y"


def run_gbs_clique_search(
    node_ids: List[str],
    adjacency_matrix: np.ndarray,
    n_samples: int = 300,
    n_iterations: int = 100,
    top_k: int = 5,
) -> Dict:
    start = time()
    node_count = len(node_ids)

    if node_count < 2:
        raise ValueError(f"Need at least 2 nodes. Got {node_count}.")
    if node_count > 35:
        raise ValueError("GBS graph must be reduced to 35 nodes or fewer")

    classical = _classical_uniform_sampling(adjacency_matrix, n_samples=n_samples, n_iterations=n_iterations)
    exact = _exact_weighted_clique(adjacency_matrix)

    try:
        samples = _sample_with_strawberryfields(adjacency_matrix, n_samples=n_samples)
        cliques = _postprocess_samples(adjacency_matrix, samples, n_iterations=n_iterations)
        backend = "strawberryfields.gaussian"
        samples_used = n_samples
    except Exception:
        cliques = [exact]
        backend = "exact_weighted_clique_fallback"
        samples_used = 0

    if not cliques:
        cliques = [exact]
        backend = "exact_weighted_clique_fallback"
        samples_used = 0

    scored = sorted(
        [(clique, _clique_weight(adjacency_matrix, clique)) for clique in cliques],
        key=lambda item: item[1],
        reverse=True,
    )
    best_clique, best_weight = scored[0]
    classical_weight = max(classical["max_clique_weight"], 1e-9)

    return {
        "ranked_node_ids": [node_ids[i] for i in best_clique],
        "all_cliques": [
            {"node_ids": [node_ids[i] for i in clique], "weight": float(weight)}
            for clique, weight in scored[:top_k]
        ],
        "max_clique_weight": float(best_weight),
        "samples_used": int(samples_used),
        "n_iterations": int(n_iterations),
        "quantum_advantage": float(best_weight / classical_weight),
        "classical_max_weight": float(classical["max_clique_weight"]),
        "backend": backend,
        "algorithm": "yu2023_banchi2020_gbs_clique",
        "paper_doi": PAPER_DOI,
        "latency_ms": int((time() - start) * 1000),
    }


def _sample_with_strawberryfields(adjacency_matrix: np.ndarray, n_samples: int) -> List[List[int]]:
    from strawberryfields.apps import sample

    scaled = rescale_for_gbs(adjacency_matrix)
    raw_samples = sample.sample(scaled, n_mean=3.0, n_samples=n_samples, threshold=True)
    return [[index for index, value in enumerate(raw) if value] for raw in raw_samples]


def _postprocess_samples(adjacency_matrix: np.ndarray, samples: Sequence[Sequence[int]], n_iterations: int) -> List[List[int]]:
    from strawberryfields.apps import clique

    cliques: List[List[int]] = []
    graph = _to_networkx_graph(adjacency_matrix)
    for sample_nodes in samples:
        if not sample_nodes:
            continue
        shrunk = clique.shrink(sample_nodes, graph)
        grown = clique.search(shrunk, graph, iterations=n_iterations)
        cliques.append(sorted(grown))
    return cliques


def _to_networkx_graph(adjacency_matrix: np.ndarray):
    import networkx as nx

    graph = nx.Graph()
    for i in range(adjacency_matrix.shape[0]):
        graph.add_node(i, weight=float(adjacency_matrix[i, i]))
    for i, j in combinations(range(adjacency_matrix.shape[0]), 2):
        if adjacency_matrix[i, j] > 0:
            graph.add_edge(i, j, weight=float(adjacency_matrix[i, j]))
    return graph


def _exact_weighted_clique(adjacency_matrix: np.ndarray) -> List[int]:
    if adjacency_matrix.shape[0] > 20:
        return _greedy_weighted_clique(adjacency_matrix)

    best: List[int] = []
    best_weight = -1.0
    n = adjacency_matrix.shape[0]
    for size in range(1, n + 1):
        for combo in combinations(range(n), size):
            if not _is_clique(adjacency_matrix, combo):
                continue
            weight = _clique_weight(adjacency_matrix, combo)
            if weight > best_weight:
                best = list(combo)
                best_weight = weight
    return best


def _greedy_weighted_clique(adjacency_matrix: np.ndarray) -> List[int]:
    best: List[int] = []
    best_weight = 0.0
    for start in range(adjacency_matrix.shape[0]):
        clique_nodes = [start]
        candidates = sorted(
            [node for node in range(adjacency_matrix.shape[0]) if node != start],
            key=lambda node: float(adjacency_matrix[node, node]),
            reverse=True,
        )
        for candidate in candidates:
            if all(adjacency_matrix[candidate, existing] > 0 for existing in clique_nodes):
                clique_nodes.append(candidate)
        weight = _clique_weight(adjacency_matrix, clique_nodes)
        if weight > best_weight:
            best = clique_nodes
            best_weight = weight
    return best


def _classical_uniform_sampling(adjacency_matrix: np.ndarray, n_samples: int = 300, n_iterations: int = 10) -> Dict:
    rng = Random(17)
    n = adjacency_matrix.shape[0]
    best_weight = 0.0

    for _ in range(max(1, n_samples)):
        seed_size = rng.randint(1, min(6, n))
        seed = rng.sample(range(n), seed_size)

        for _ in range(max(1, n_iterations)):
            candidates = [
                node
                for node in range(n)
                if node not in seed and all(adjacency_matrix[node, other] > 0 for other in seed)
            ]
            if not candidates:
                break
            candidates.sort(key=lambda node: float(adjacency_matrix[node, node]), reverse=True)
            seed.append(candidates[0])

        clique = _shrink_to_clique(adjacency_matrix, seed)
        best_weight = max(best_weight, _clique_weight(adjacency_matrix, clique))

    return {"max_clique_weight": float(best_weight)}


def _shrink_to_clique(adjacency_matrix: np.ndarray, nodes: Sequence[int]) -> List[int]:
    ordered = sorted(set(nodes), key=lambda node: float(adjacency_matrix[node, node]), reverse=True)
    clique_nodes: List[int] = []
    for node in ordered:
        if all(adjacency_matrix[node, existing] > 0 for existing in clique_nodes):
            clique_nodes.append(node)
    return clique_nodes


def _is_clique(adjacency_matrix: np.ndarray, combo: Sequence[int]) -> bool:
    return all(adjacency_matrix[i, j] > 0 for i, j in combinations(combo, 2))


def _clique_weight(adjacency_matrix: np.ndarray, clique: Sequence[int]) -> float:
    node_weight = sum(float(adjacency_matrix[i, i]) for i in clique)
    edge_weight = sum(float(adjacency_matrix[i, j]) for i, j in combinations(clique, 2))
    return float(node_weight + edge_weight)

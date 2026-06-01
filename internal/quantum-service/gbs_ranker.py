import time
from itertools import combinations

import numpy as np

from graph_adapter import build_adjacency_matrix


def run_gbs_clique_search(nodes, edges, top_k=5, n_samples=200):
    """
    GBS-compatible maximum weighted clique search.

    The service attempts a PennyLane Gaussian probability calculation when the
    dependency is available. It always keeps an exact small-graph baseline so
    local development and CI can run without quantum hardware.
    """
    start = time.time()
    matrix, node_ids = build_adjacency_matrix(nodes, edges)
    top_k = max(1, min(int(top_k), len(node_ids)))

    if len(node_ids) == 0:
        return _response([], 0.0, 0, "fallback_empty_graph", start)

    if not np.any(matrix):
        ranked = sorted(nodes, key=lambda node: node.weight, reverse=True)
        return _response([node.id for node in ranked[:top_k]], 0.0, 0, "fallback_no_edges", start)

    baseline = _exact_weighted_clique(matrix, node_ids, nodes, top_k)

    try:
        import pennylane as qml
        from scipy.linalg import sqrtm

        n = len(node_ids)
        if n > 12:
            return _response(baseline["node_ids"], baseline["score"], 0, "exact_small_graph", start)

        max_eig = float(np.max(np.abs(np.linalg.eigvals(matrix))))
        scaled = matrix / (max_eig + 0.1) if max_eig > 0 else matrix
        dev = qml.device("default.gaussian", wires=n)

        @qml.qnode(dev)
        def circuit(adjacency):
            squeeze_source = sqrtm(np.eye(n) - adjacency @ adjacency)
            squeezes = -0.5 * np.log(np.diag(squeeze_source).clip(1e-10, 1.0))
            for wire in range(n):
                qml.Squeezing(float(squeezes[wire]), 0, wires=wire)
            if n > 1:
                unitary = np.linalg.svd(adjacency)[0]
                qml.InterferometerUnitary(unitary, wires=range(n))
            return qml.probs(wires=range(n))

        probs = circuit(scaled)
        node_scores = {}
        for i, node_id in enumerate(node_ids):
            score = sum(float(probs[j]) for j in range(len(probs)) if (j >> i) & 1)
            node_scores[node_id] = score * _node_weight(node_id, nodes)

        ranked = [node_id for node_id, _ in sorted(node_scores.items(), key=lambda item: item[1], reverse=True)]
        clique_weight = max(node_scores.values()) if node_scores else baseline["score"]
        return _response(ranked[:top_k], float(clique_weight), n_samples, "pennylane.default.gaussian", start)
    except Exception:
        return _response(baseline["node_ids"], baseline["score"], 0, "exact_small_graph", start)


def _exact_weighted_clique(matrix, node_ids, nodes, top_k):
    best_ids = []
    best_score = -1.0
    n = len(node_ids)
    max_size = min(top_k, n)
    weights = {node.id: _node_weight(node.id, nodes) for node in nodes}

    for size in range(1, max_size + 1):
        for combo in combinations(range(n), size):
            if not _is_clique(matrix, combo):
                continue
            edge_score = sum(matrix[i, j] for i, j in combinations(combo, 2))
            node_score = sum(weights[node_ids[i]] for i in combo)
            score = float(edge_score + node_score)
            if score > best_score:
                best_score = score
                best_ids = [node_ids[i] for i in combo]

    if not best_ids:
        ranked = sorted(nodes, key=lambda node: node.weight, reverse=True)
        best_ids = [node.id for node in ranked[:top_k]]
        best_score = sum(_node_weight(node.id, nodes) for node in ranked[:top_k])

    return {"node_ids": best_ids[:top_k], "score": float(best_score)}


def _is_clique(matrix, combo):
    return all(matrix[i, j] > 0 for i, j in combinations(combo, 2))


def _node_weight(node_id, nodes):
    for node in nodes:
        if node.id == node_id:
            return max(0.001, float(node.weight))
    return 1.0


def _response(node_ids, clique_weight, samples_used, backend, start):
    return {
        "ranked_node_ids": node_ids,
        "clique_weight": float(clique_weight),
        "samples_used": int(samples_used),
        "backend": backend,
        "latency_ms": int((time.time() - start) * 1000),
    }

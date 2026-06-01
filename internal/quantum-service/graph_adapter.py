import numpy as np


def build_adjacency_matrix(nodes, edges):
    node_ids = [node.id for node in nodes]
    index = {node_id: i for i, node_id in enumerate(node_ids)}
    matrix = np.zeros((len(node_ids), len(node_ids)))
    node_weights = {node.id: max(0.001, float(node.weight)) for node in nodes}

    for edge in edges:
        if edge.source not in index or edge.target not in index:
            continue
        i = index[edge.source]
        j = index[edge.target]
        edge_weight = max(0.0, min(1.0, float(edge.weight)))
        weighted = edge_weight * ((node_weights[edge.source] + node_weights[edge.target]) / 2)
        matrix[i, j] = weighted
        matrix[j, i] = weighted

    return matrix, node_ids

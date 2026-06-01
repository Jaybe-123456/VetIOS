"""
GBS-based veterinary QIVS screening.

This module hashes SMILES immediately and stores/returns only derived binding
features and lineage data.
"""

import hashlib
from time import time
from typing import Dict, List, Optional

import numpy as np

from big_constructor import PharmacophorePoint, PharmacophoreType, build_big
from gbs_differential import PAPER_DOI, run_gbs_clique_search


DEFAULT_RECEPTORS = {
    "staph_pseudintermedius": [
        ("HA1", "HA", (0.0, 0.0, 0.0)),
        ("HD1", "HD", (2.5, 0.5, 0.2)),
        ("NC1", "NC", (1.2, 2.0, 0.4)),
        ("AR1", "AR", (3.1, 2.1, 0.0)),
    ],
    "ecoli_amr": [
        ("HA1", "HA", (0.0, 0.0, 0.0)),
        ("NC1", "NC", (2.0, 0.2, 0.0)),
        ("HD1", "HD", (0.4, 2.4, 0.3)),
        ("AR1", "AR", (2.8, 2.2, 0.1)),
    ],
    "salmonella_infantis": [
        ("HA1", "HA", (0.1, 0.0, 0.0)),
        ("NC1", "NC", (1.9, 0.6, 0.0)),
        ("AR1", "AR", (2.7, 2.5, 0.2)),
        ("HD1", "HD", (0.4, 2.2, 0.5)),
    ],
    "brucella_abortus": [
        ("HA1", "HA", (0.0, 0.0, 0.2)),
        ("HD1", "HD", (2.1, 0.4, 0.1)),
        ("NC1", "NC", (0.5, 2.3, 0.0)),
        ("AR1", "AR", (2.8, 2.2, 0.4)),
    ],
    "mannheimia_haemolytica": [
        ("HA1", "HA", (0.2, 0.0, 0.0)),
        ("HD1", "HD", (2.2, 0.7, 0.3)),
        ("NC1", "NC", (0.7, 2.1, 0.1)),
        ("AR1", "AR", (3.0, 2.2, 0.2)),
    ],
}


def screen_drug_against_pathogen(
    drug_pharmacophores: List[PharmacophorePoint],
    receptor_pharmacophores: List[PharmacophorePoint],
    drug_smiles: str,
    pathogen_label: str,
    tau: float = 1.5,
    epsilon: float = 0.5,
    n_samples: int = 300,
    n_iterations: int = 100,
) -> Dict:
    start = time()
    drug_hash = hashlib.sha256(drug_smiles.encode("utf-8")).hexdigest()

    contact_nodes, matrix = build_big(
        receptor_pharmacophores,
        drug_pharmacophores,
        tau=tau,
        epsilon=epsilon,
    )

    if len(contact_nodes) > 35:
        top_indices = np.argsort(np.diag(matrix))[::-1][:28]
        matrix = matrix[np.ix_(top_indices, top_indices)]
        contact_nodes = [contact_nodes[i] for i in top_indices]

    gbs_result = run_gbs_clique_search(
        node_ids=[node.id for node in contact_nodes],
        adjacency_matrix=matrix,
        n_samples=n_samples,
        n_iterations=n_iterations,
        top_k=5,
    )

    all_cliques = gbs_result.get("all_cliques", [])
    max_weight = float(gbs_result["max_clique_weight"])
    matches = sum(1 for clique in all_cliques if abs(float(clique["weight"]) - max_weight) < 0.01)
    confidence = matches / len(all_cliques) if all_cliques else 0.0

    return {
        "drug_smiles_hash": drug_hash,
        "pathogen_label": pathogen_label,
        "big_node_count": len(contact_nodes),
        "big_edge_count": int((np.count_nonzero(matrix) - len(contact_nodes)) / 2),
        "tau_flexibility": tau,
        "epsilon_interaction": epsilon,
        "max_clique_nodes": gbs_result["ranked_node_ids"],
        "max_clique_weight": max_weight,
        "binding_pose": _extract_binding_pose(gbs_result["ranked_node_ids"], contact_nodes),
        "gbs_samples_used": int(gbs_result["samples_used"]),
        "gbs_backend": gbs_result["backend"],
        "classical_max_weight": float(gbs_result["classical_max_weight"]),
        "quantum_advantage": float(gbs_result["quantum_advantage"]),
        "confidence_score": float(confidence),
        "algorithm_version": "banchi2020_yu2023",
        "paper_doi": PAPER_DOI,
        "latency_ms": int((time() - start) * 1000),
    }


def pharmacophore_from_payload(payload: Dict, is_protein: bool) -> PharmacophorePoint:
    ptype = _parse_pharmacophore_type(payload["type"])
    return PharmacophorePoint(
        id=str(payload["id"]),
        ptype=ptype,
        position=np.array(payload["position"], dtype=float),
        is_protein=is_protein,
    )


def default_receptor_for_pathogen(pathogen_label: str) -> List[PharmacophorePoint]:
    raw = DEFAULT_RECEPTORS.get(pathogen_label)
    if raw is None:
        raw = DEFAULT_RECEPTORS["ecoli_amr"]
    return [
        PharmacophorePoint(
            id=item[0],
            ptype=_parse_pharmacophore_type(item[1]),
            position=np.array(item[2], dtype=float),
            is_protein=True,
        )
        for item in raw
    ]


def default_ligand_from_smiles(drug_smiles: str) -> List[PharmacophorePoint]:
    digest = hashlib.sha256(drug_smiles.encode("utf-8")).digest()
    types = [PharmacophoreType.HD, PharmacophoreType.HA, PharmacophoreType.AR, PharmacophoreType.HD]
    points: List[PharmacophorePoint] = []
    for i, ptype in enumerate(types):
        points.append(
            PharmacophorePoint(
                id=f"L{i + 1}",
                ptype=ptype,
                position=np.array(
                    [
                        float(digest[i] % 31) / 10.0,
                        float(digest[i + 4] % 31) / 10.0,
                        float(digest[i + 8] % 11) / 10.0,
                    ],
                    dtype=float,
                ),
                is_protein=False,
            )
        )
    return points


def _parse_pharmacophore_type(value: str) -> PharmacophoreType:
    key = value.strip().upper()
    if key not in PharmacophoreType.__members__:
        raise ValueError(f"Unsupported pharmacophore type: {value}")
    return PharmacophoreType[key]


def _extract_binding_pose(clique_node_ids: List[str], contact_nodes: List) -> Dict:
    clique = set(clique_node_ids)
    contacts = []
    for node in contact_nodes:
        if node.id not in clique:
            continue
        contacts.append(
            {
                "contact_id": node.id,
                "protein_point": node.protein_point.id,
                "ligand_point": node.ligand_point.id,
                "interaction_type": node.protein_point.ptype.value,
                "contact_weight": float(node.weight),
            }
        )
    return {"contacts": contacts, "n_contacts": len(contacts)}

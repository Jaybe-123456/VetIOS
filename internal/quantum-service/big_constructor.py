"""
Binding Interaction Graph (BIG) construction for QIVS.

Based on Yu et al. (2023), Nature Computational Science.
DOI: 10.1038/s43588-023-00526-y

Nodes are compatible receptor-ligand pharmacophore contacts. Edges connect
contacts that can coexist under the tau + 2 epsilon flexibility rule.
"""

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Tuple

import numpy as np


class PharmacophoreType(Enum):
    HA = "hydrogen_bond_acceptor"
    HD = "hydrogen_bond_donor"
    NC = "negative_charge"
    AR = "aromatic"


@dataclass(frozen=True)
class PharmacophorePoint:
    id: str
    ptype: PharmacophoreType
    position: np.ndarray
    is_protein: bool


@dataclass(frozen=True)
class ContactNode:
    id: str
    protein_point: PharmacophorePoint
    ligand_point: PharmacophorePoint
    weight: float


def compute_contact_potential(
    protein_point: PharmacophorePoint,
    ligand_point: PharmacophorePoint,
) -> Optional[float]:
    compatible = {
        (PharmacophoreType.HA, PharmacophoreType.HD): 1.0,
        (PharmacophoreType.HD, PharmacophoreType.HA): 1.0,
        (PharmacophoreType.NC, PharmacophoreType.HD): 0.8,
        (PharmacophoreType.AR, PharmacophoreType.AR): 0.6,
    }
    return compatible.get((protein_point.ptype, ligand_point.ptype))


def are_contacts_compatible(
    contact_a: ContactNode,
    contact_b: ContactNode,
    tau: float = 1.5,
    epsilon: float = 0.5,
) -> bool:
    if contact_a.protein_point.id == contact_b.protein_point.id:
        return False
    if contact_a.ligand_point.id == contact_b.ligand_point.id:
        return False

    ligand_distance = float(
        np.linalg.norm(contact_a.ligand_point.position - contact_b.ligand_point.position)
    )
    protein_distance = float(
        np.linalg.norm(contact_a.protein_point.position - contact_b.protein_point.position)
    )

    return abs(ligand_distance - protein_distance) <= tau + 2 * epsilon


def build_big(
    protein_points: List[PharmacophorePoint],
    ligand_points: List[PharmacophorePoint],
    tau: float = 1.5,
    epsilon: float = 0.5,
) -> Tuple[List[ContactNode], np.ndarray]:
    nodes: List[ContactNode] = []

    for protein_point in protein_points:
        for ligand_point in ligand_points:
            potential = compute_contact_potential(protein_point, ligand_point)
            if potential is None:
                continue
            nodes.append(
                ContactNode(
                    id=f"({protein_point.id},{ligand_point.id})",
                    protein_point=protein_point,
                    ligand_point=ligand_point,
                    weight=potential,
                )
            )

    if not nodes:
        raise ValueError("No compatible pharmacophore contacts found")

    matrix = np.zeros((len(nodes), len(nodes)), dtype=float)
    for i, node in enumerate(nodes):
        matrix[i, i] = node.weight
        for j in range(i + 1, len(nodes)):
            if are_contacts_compatible(node, nodes[j], tau=tau, epsilon=epsilon):
                matrix[i, j] = 1.0
                matrix[j, i] = 1.0

    return nodes, matrix


def rescale_for_gbs(matrix: np.ndarray, c: Optional[float] = None, alpha: float = 0.1) -> np.ndarray:
    """Rescale a weighted graph matrix so eigenvalues sit below one."""
    if matrix.size == 0:
        return matrix

    weights = np.diag(matrix)
    offdiag = matrix.copy()
    np.fill_diagonal(offdiag, 0.0)
    degree = np.diag(offdiag.sum(axis=1))
    laplacian = degree - offdiag

    if c is None:
        eigvals = np.abs(np.linalg.eigvals(laplacian))
        max_eig = float(eigvals.max()) if eigvals.size else 0.0
        c = 0.9 / (max_eig + 1e-6) if max_eig > 0 else 0.1

    omega = np.diag(c * (1 + alpha * weights))
    scaled = omega @ laplacian @ omega
    eigvals = np.abs(np.linalg.eigvals(scaled))

    if eigvals.size and float(eigvals.max()) >= 1.0:
        factor = 0.95 / (float(eigvals.max()) + 1e-6)
        scaled = scaled * factor

    return scaled

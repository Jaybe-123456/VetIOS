from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Optional

from amr_screener import screen_sequence
from graph_adapter import build_adjacency_matrix
from gbs_differential import run_gbs_clique_search as run_gbs_differential_search
from gbs_drug_discovery import (
    default_ligand_from_smiles,
    default_receptor_for_pathogen,
    pharmacophore_from_payload,
    screen_drug_against_pathogen,
)
from gbs_rna_folding import predict_rna_structure


app = FastAPI(title="VetIOS Quantum Service")


class GraphNode(BaseModel):
    id: str
    weight: float


class GraphEdge(BaseModel):
    source: str
    target: str
    weight: float


class GBSRankRequest(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]
    top_k: int = 5
    n_samples: int = 20
    n_iterations: int = 5


class GBSRankResponse(BaseModel):
    ranked_node_ids: List[str]
    clique_weight: float
    samples_used: int
    backend: str
    latency_ms: int
    classical_max_weight: float
    quantum_advantage: float


class AMRScreenRequest(BaseModel):
    sequence: str
    species: str


class AMRScreenResponse(BaseModel):
    sequence_hash: str
    resistance_genes: List[str]
    resistance_classes: List[str]
    novel_pattern_score: float
    quantum_backend: Optional[str]
    card_db_version: str
    latency_ms: int


class PharmacophoreInput(BaseModel):
    id: str
    type: str
    position: List[float]
    is_protein: bool


class PharmacophoreSet(BaseModel):
    receptor: List[PharmacophoreInput]
    ligand: List[PharmacophoreInput]


class QIVSScreenRequest(BaseModel):
    drug_smiles: str
    pathogen_label: str
    tau_flexibility: float = 1.5
    epsilon_interaction: float = 0.5
    n_samples: int = 20
    n_iterations: int = 5
    pharmacophores: Optional[PharmacophoreSet] = None


class QIVSScreenResponse(BaseModel):
    drug_smiles_hash: str
    pathogen_label: str
    big_node_count: int
    big_edge_count: int
    tau_flexibility: float
    epsilon_interaction: float
    max_clique_nodes: List[str]
    max_clique_weight: float
    binding_pose: Dict[str, Any]
    gbs_samples_used: int
    gbs_backend: str
    classical_max_weight: float
    quantum_advantage: float
    confidence_score: float
    algorithm_version: str
    paper_doi: str
    latency_ms: int


class RNAFoldRequest(BaseModel):
    sequence: str
    pathogen_label: str
    region: Optional[str] = None
    reference_structure: Optional[str] = None
    n_samples: int = 20
    n_iterations: int = 5


class RNAFoldResponse(BaseModel):
    sequence_hash: str
    sequence_length: int
    pathogen_label: str
    region: Optional[str]
    wfsg_node_count: int
    wfsg_edge_count: int
    predicted_stems: List[Dict[str, int]]
    secondary_structure: str
    max_clique_weight: float
    mcc_score: Optional[float]
    gbs_backend: str
    quantum_advantage: float
    algorithm_version: str
    paper_doi: str
    latency_ms: int


@app.post("/rank", response_model=GBSRankResponse)
async def rank_graph(request: GBSRankRequest):
    if len(request.nodes) < 2:
        raise HTTPException(400, "Minimum 2 nodes required for GBS ranking")
    if len(request.nodes) > 35:
        raise HTTPException(400, "Maximum 35 nodes for current Yu/Banchi GBS implementation")

    matrix, node_ids = build_adjacency_matrix(request.nodes, request.edges)
    for index, node in enumerate(request.nodes):
        matrix[index, index] = max(0.001, float(node.weight))

    result = run_gbs_differential_search(
        node_ids=node_ids,
        adjacency_matrix=matrix,
        n_samples=request.n_samples,
        n_iterations=request.n_iterations,
        top_k=request.top_k,
    )
    return {
        "ranked_node_ids": result["ranked_node_ids"],
        "clique_weight": result["max_clique_weight"],
        "samples_used": result["samples_used"],
        "backend": result["backend"],
        "latency_ms": result["latency_ms"],
        "classical_max_weight": result["classical_max_weight"],
        "quantum_advantage": result["quantum_advantage"],
    }


@app.post("/amr/screen", response_model=AMRScreenResponse)
async def screen_amr(request: AMRScreenRequest):
    if not request.sequence.strip() or not request.species.strip():
        raise HTTPException(400, "sequence and species are required")
    return screen_sequence(request.sequence, request.species)


@app.post("/qivs/screen", response_model=QIVSScreenResponse)
async def screen_qivs(request: QIVSScreenRequest):
    if not request.drug_smiles.strip() or not request.pathogen_label.strip():
        raise HTTPException(400, "drug_smiles and pathogen_label are required")

    try:
        if request.pharmacophores:
            receptor = [
                pharmacophore_from_payload(item.model_dump(), is_protein=True)
                for item in request.pharmacophores.receptor
            ]
            ligand = [
                pharmacophore_from_payload(item.model_dump(), is_protein=False)
                for item in request.pharmacophores.ligand
            ]
        else:
            receptor = default_receptor_for_pathogen(request.pathogen_label)
            ligand = default_ligand_from_smiles(request.drug_smiles)

        return screen_drug_against_pathogen(
            drug_pharmacophores=ligand,
            receptor_pharmacophores=receptor,
            drug_smiles=request.drug_smiles,
            pathogen_label=request.pathogen_label,
            tau=request.tau_flexibility,
            epsilon=request.epsilon_interaction,
            n_samples=request.n_samples,
            n_iterations=request.n_iterations,
        )
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except Exception as error:
        raise HTTPException(503, f"QIVS screening failed: {error}") from error


@app.post("/rna/fold", response_model=RNAFoldResponse)
async def fold_rna(request: RNAFoldRequest):
    if not request.sequence.strip() or not request.pathogen_label.strip():
        raise HTTPException(400, "sequence and pathogen_label are required")

    try:
        return predict_rna_structure(
            sequence=request.sequence,
            pathogen_label=request.pathogen_label,
            region=request.region,
            reference_structure=request.reference_structure,
            n_samples=request.n_samples,
            n_iterations=request.n_iterations,
        )
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except Exception as error:
        raise HTTPException(503, f"RNA folding failed: {error}") from error


@app.get("/health")
async def health():
    return {"status": "ok", "backend": "pennylane.simulator"}

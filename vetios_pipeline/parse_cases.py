import os
import json
import re
import logging
from tqdm import tqdm

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

PARSED_DIR = "vetios_pipeline/parsed_text"
DATASET_FILE = "vetios_pipeline/datasets/vetios_dataset.jsonl"

os.makedirs(os.path.dirname(DATASET_FILE), exist_ok=True)

SPECIES_MAP = {
    r"\b(dog|canine|puppy|hound)\b": "Dog",
    r"\b(cat|feline|kitten)\b": "Cat"
}

SYMPTOMS_LIST = [
    "vomiting", "diarrhea", "cough", "sneezing", "dyspnea", "fever", 
    "anorexia", "lethargy", "weight loss", "nasal discharge", "PU/PD", 
    "seizures", "lameness", "weakness", "pale mucous membranes"
]

DIAGNOSTICS_LIST = [
    "CBC", "chemistry", "urinalysis", "radiographs", "ultrasound", 
    "cytology", "PCR", "biopsy"
]

def extract_structured_case(text):
    # Rule-based signal detection
    species = "Unspecified"
    for pattern, label in SPECIES_MAP.items():
        if re.search(pattern, text, re.IGNORECASE):
            species = label
            break
            
    found_symptoms = []
    for symptom in SYMPTOMS_LIST:
        if re.search(r"\b" + re.escape(symptom) + r"\b", text, re.IGNORECASE):
            found_symptoms.append(symptom)
            
    found_diagnostics = []
    for diag in DIAGNOSTICS_LIST:
        if re.search(r"\b" + re.escape(diag) + r"\b", text, re.IGNORECASE):
            found_diagnostics.append(diag)
            
    if not found_symptoms and species == "Unspecified":
        return None
        
    # Generate mock reasoning based on clusters (Step 5 logic)
    # In a real scenario, this would be validated clinical data or synthesized by a larger model,
    # but here we generate structured patterns as requested.
    
    # Heuristic: If it has sneezing/nasal discharge -> URI
    # If vomiting/diarrhea -> Gastroenteritis
    # If PU/PD -> CKD or Diabetes
    
    top_diff = "General Internal Medicine Case"
    confidence = 0.75
    alternatives = ["Inflammatory disease", "Infectious process"]
    next_test = "Full diagnostic workup"
    
    if "sneezing" in found_symptoms or "nasal discharge" in found_symptoms:
        top_diff = "URI Complex"
        confidence = 0.88
        alternatives = ["Chlamydophila felis", "Calicivirus", "FHV-1"]
        next_test = "PCR Respiratory Panel"
    elif "PU/PD" in found_symptoms:
        if species == "Cat" and ("weight loss" in found_symptoms):
            top_diff = "Chronic Kidney Disease"
            confidence = 0.91
            alternatives = ["Diabetes Mellitus", "Hyperthyroidism"]
            next_test = "Urinalysis, SDMA, T4"
        elif species == "Dog":
            top_diff = "Hyperadrenocorticism"
            confidence = 0.85
            alternatives = ["Diabetes Mellitus", "Psychogenic Polydipsia"]
            next_test = "LDDS Test or ACTH Stimulation"
    elif "vomiting" in found_symptoms or "diarrhea" in found_symptoms:
        top_diff = "Gastroenteritis"
        confidence = 0.82
        alternatives = ["Dietary Indiscretion", "Pancreatitis", "IBD"]
        next_test = "Abdominal Ultrasound / PLI test"

    instruction = "Analyze the following veterinary clinical case and provide structured reasoning and recommendations."
    input_text = f"Species: {species}\nSymptoms: {', '.join(found_symptoms) if found_symptoms else 'N/A'}\nDiagnostics Mentioned: {', '.join(found_diagnostics) if found_diagnostics else 'None'}"
    
    output_text = f"Top Differential: {top_diff}\nConfidence: {confidence}\nAlternative Diagnoses:\n"
    output_text += "\n".join([f"- {alt}" for alt in alternatives])
    output_text += f"\nRecommended Next Test:\n- {next_test}"
    
    return {
        "instruction": instruction,
        "input": input_text,
        "output": output_text
    }

def run_parsing():
    all_files = [f for f in os.listdir(PARSED_DIR) if f.endswith(".txt")]
    logger.info(f"Parsing {len(all_files)} text files...")
    
    cases = []
    for filename in tqdm(all_files, desc="Parsing cases"):
        with open(os.path.join(PARSED_DIR, filename), 'r', encoding='utf-8') as f:
            text = f.read()
            case = extract_structured_case(text)
            if case:
                cases.append(case)
                
    # Deduplicate
    unique_cases = []
    seen_inputs = set()
    for c in cases:
        if c["input"] not in seen_inputs:
            unique_cases.append(c)
            seen_inputs.add(c["input"])
            
    logger.info(f"Extracted {len(unique_cases)} unique veterinary cases.")
    
    with open(DATASET_FILE, 'w', encoding='utf-8') as f:
        for case in unique_cases:
            f.write(json.dumps(case) + "\n")
            
    logger.info(f"Saved dataset to {DATASET_FILE}")

if __name__ == "__main__":
    run_parsing()

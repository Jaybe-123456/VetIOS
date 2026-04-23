import json
import random
from datasets import load_dataset
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

VET_FILE = "vetios_pipeline/datasets/vetios_dataset.jsonl"
FINAL_FILE = "vetios_pipeline/datasets/merged_vetios.json"

def check_integrity(dataset):
    for i, item in enumerate(dataset):
        if not all(k in item for k in ["instruction", "input", "output"]):
            logger.error(f"Integrity check failed at index {i}: Missing keys.")
            return False
        if not item["instruction"].strip() or not item["output"].strip():
            logger.error(f"Integrity check failed at index {i}: Empty fields.")
            return False
    return True

def prepare_dataset():
    # ... (existing code snippet starts here)
    vet_data = []
    try:
        with open(VET_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    vet_data.append(json.loads(line))
        logger.info(f"Loaded {len(vet_data)} veterinary examples.")
    except Exception as e:
        logger.error(f"Error loading vet dataset: {e}")
        return

    if len(vet_data) == 0:
        logger.warning("No veterinary data found. Check extraction/parsing steps.")
        return

    # Load Alpaca-cleaned
    logger.info("Downloading unsloth/alpaca-cleaned JSON directly...")
    import requests
    url = "https://huggingface.co/datasets/yahma/alpaca-cleaned/resolve/main/alpaca_data_cleaned.json"
    try:
        response = requests.get(url)
        response.raise_for_status()
        alpaca_json = response.json()
        alpaca_list = []
        for example in alpaca_json:
            alpaca_list.append({
                "instruction": example["instruction"],
                "input": example["input"],
                "output": example["output"]
            })
        logger.info(f"Loaded {len(alpaca_list)} alpaca examples.")
    except Exception as e:
        logger.error(f"Error downloading alpaca dataset: {e}")
        return
    
    required_alpaca_size = int(len(vet_data) * (7/3))
    sampled_alpaca = random.sample(alpaca_list, min(len(alpaca_list), required_alpaca_size))
    
    final_dataset = sampled_alpaca + vet_data
    random.shuffle(final_dataset)
    
    if not check_integrity(final_dataset):
        logger.error("Dataset integrity check failed. Aborting save.")
        return

    logger.info(f"Final dataset size: {len(final_dataset)} (Alpaca: {len(sampled_alpaca)}, Vet: {len(vet_data)})")
    
    with open(FINAL_FILE, 'w', encoding='utf-8') as f:
        json.dump(final_dataset, f, indent=2)
        
    logger.info(f"Saved merged dataset to {FINAL_FILE}")

if __name__ == "__main__":
    prepare_dataset()

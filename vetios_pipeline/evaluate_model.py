from unsloth import FastLanguageModel
import torch
import json
import os
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

MODEL_PATH = "vetios_pipeline/final_model"

test_cases = [
    {
        "instruction": "Analyze the following veterinary clinical case and provide structured reasoning and recommendations.",
        "input": "Species: Cat\nSymptoms: Sneezing, conjunctivitis, fever",
        "expected": "URI Complex, Chlamydophila felis, Calicivirus"
    },
    {
        "instruction": "Analyze the following veterinary clinical case and provide structured reasoning and recommendations.",
        "input": "Species: Dog\nSymptoms: PU/PD, weight gain, panting",
        "expected": "Hyperadrenocorticism, Diabetes Mellitus"
    }
]

def run_evaluation():
    if not os.path.exists(MODEL_PATH):
        logger.error("Model not found. Run training first.")
        return

    logger.info("Loading fine-tuned model for evaluation...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name = MODEL_PATH,
        max_seq_length = 4096,
        dtype = None,
        load_in_4bit = True,
    )
    FastLanguageModel.for_inference(model)

    prompt_template = """### Instruction:
{}

### Input:
{}

### Response:
"""

    results = []
    for case in test_cases:
        inputs = tokenizer(
            [prompt_template.format(case["instruction"], case["input"])],
            return_tensors = "pt"
        ).to("cuda")

        outputs = model.generate(**inputs, max_new_tokens = 256, use_cache = True)
        decoded = tokenizer.batch_decode(outputs)
        
        # Extract response
        response = decoded[0].split("### Response:")[1].strip()
        results.append({
            "input": case["input"],
            "expected": case["expected"],
            "generated": response
        })
        logger.info(f"Test case Input: {case['input']}\nGenerated: {response}\n")

    with open("vetios_pipeline/evaluation/results.json", "w") as f:
        json.dump(results, f, indent=2)
        
    logger.info("Evaluation results saved to vetios_pipeline/evaluation/results.json")

if __name__ == "__main__":
    run_evaluation()

import argparse
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import torch
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template

try:
    from prepare_dataset import SYSTEM_PROMPT
except ImportError:  # pragma: no cover
    from vetios_pipeline.prepare_dataset import SYSTEM_PROMPT

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_MODEL_PATH = "vetios_pipeline/final_model"
DEFAULT_EVAL_FILE = "vetios_pipeline/evaluation/eval_cases.jsonl"
DEFAULT_RESULTS_FILE = "vetios_pipeline/evaluation/results.json"


def iter_jsonl(path: Path) -> Iterable[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_no} is not valid JSON: {exc}") from exc
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_no} must be a JSON object")
            yield value


def build_messages(case: Dict[str, Any]) -> List[Dict[str, str]]:
    structured_case = case.get("structured_case")
    if not isinstance(structured_case, dict):
        raise ValueError(f"{case.get('case_id', '<unknown>')} missing structured_case object")
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Analyze this veterinary clinical case. Return only the validated structured JSON format.\n\n"
                "Case JSON:\n"
                f"{json.dumps(structured_case, ensure_ascii=False, sort_keys=True)}"
            ),
        },
    ]


def extract_json(response: str) -> Optional[Any]:
    text = response.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if fenced:
        text = fenced.group(1).strip()
    start_candidates = [pos for pos in (text.find("{"), text.find("[")) if pos >= 0]
    if start_candidates:
        text = text[min(start_candidates) :]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def score_response(case: Dict[str, Any], response: str) -> Dict[str, Any]:
    lower = response.lower()
    required_terms = [term.lower() for term in case.get("required_terms", [])]
    forbidden_terms = [term.lower() for term in case.get("forbidden_terms", [])]
    required_json_keys = case.get("required_json_keys", [])

    missing_terms = [term for term in required_terms if term not in lower]
    present_forbidden_terms = [term for term in forbidden_terms if term in lower]
    parsed_json = extract_json(response)

    missing_json_keys: List[str] = []
    if required_json_keys:
        if not isinstance(parsed_json, dict):
            missing_json_keys = list(required_json_keys)
        else:
            missing_json_keys = [key for key in required_json_keys if key not in parsed_json]

    passed = not missing_terms and not present_forbidden_terms and not missing_json_keys
    return {
        "passed": passed,
        "missing_terms": missing_terms,
        "present_forbidden_terms": present_forbidden_terms,
        "json_parseable": parsed_json is not None,
        "missing_json_keys": missing_json_keys,
    }


def run_evaluation(args: argparse.Namespace) -> None:
    model_path = Path(args.model)
    eval_path = Path(args.eval_file)
    if not model_path.exists() and "/" not in args.model:
        raise FileNotFoundError(f"model not found: {model_path}")
    if not eval_path.exists():
        raise FileNotFoundError(
            f"eval file not found: {eval_path}. Copy eval_cases.example.jsonl and add your reviewed cases."
        )

    logger.info("loading model for evaluation: %s", args.model)
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=args.max_seq_length,
        dtype=None,
        load_in_4bit=args.load_in_4bit,
    )
    tokenizer = get_chat_template(tokenizer, chat_template=args.chat_template)
    FastLanguageModel.for_inference(model)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    results: List[Dict[str, Any]] = []

    for case in iter_jsonl(eval_path):
        messages = build_messages(case)
        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = tokenizer([prompt], return_tensors="pt").to(device)
        outputs = model.generate(
            **inputs,
            max_new_tokens=args.max_new_tokens,
            temperature=args.temperature,
            do_sample=args.temperature > 0,
            use_cache=True,
        )
        new_tokens = outputs[:, inputs.input_ids.shape[1] :]
        response = tokenizer.batch_decode(new_tokens, skip_special_tokens=True)[0].strip()
        score = score_response(case, response)
        result = {
            "case_id": case.get("case_id"),
            "passed": score["passed"],
            "score": score,
            "generated": response,
        }
        results.append(result)
        logger.info("%s: %s", case.get("case_id"), "PASS" if score["passed"] else "FAIL")

    passed = sum(1 for item in results if item["passed"])
    summary = {
        "passed": passed,
        "total": len(results),
        "pass_rate": passed / len(results) if results else 0,
        "results": results,
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info("wrote evaluation results to %s", output_path)
    logger.info("pass rate: %.2f%% (%s/%s)", summary["pass_rate"] * 100, passed, len(results))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run lightweight VetIOS adapter evaluation cases.")
    parser.add_argument("--model", default=DEFAULT_MODEL_PATH)
    parser.add_argument("--eval-file", default=DEFAULT_EVAL_FILE)
    parser.add_argument("--output", default=DEFAULT_RESULTS_FILE)
    parser.add_argument("--max-seq-length", type=int, default=4096)
    parser.add_argument("--max-new-tokens", type=int, default=512)
    parser.add_argument("--load-in-4bit", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--chat-template", default="qwen2.5")
    parser.add_argument("--temperature", type=float, default=0.0)
    return parser


if __name__ == "__main__":
    run_evaluation(build_parser().parse_args())

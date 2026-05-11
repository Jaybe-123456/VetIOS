import argparse
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

import torch
from datasets import load_dataset
from transformers import TrainingArguments
from trl import SFTTrainer
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template

try:
    from unsloth.chat_templates import train_on_responses_only
except ImportError:  # pragma: no cover - depends on installed Unsloth version
    train_on_responses_only = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_MODEL = os.environ.get("VETIOS_BASE_MODEL", "VetIOS/vetios-qwen2.5-0.5b-ready")
DEFAULT_TRAIN_FILE = "vetios_pipeline/datasets/prepared/train.jsonl"
DEFAULT_EVAL_FILE = "vetios_pipeline/datasets/prepared/eval.jsonl"
DEFAULT_OUTPUT_DIR = "vetios_pipeline/final_model"
DEFAULT_CHECKPOINT_DIR = "vetios_pipeline/checkpoints"

TARGET_MODULES = [
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
]


def load_prepared_dataset(train_file: str, eval_file: Optional[str]):
    data_files: Dict[str, str] = {"train": train_file}
    if eval_file and Path(eval_file).exists():
        data_files["eval"] = eval_file
    dataset = load_dataset("json", data_files=data_files)
    return dataset["train"], dataset.get("eval")


def apply_qwen_chat_template(dataset, tokenizer, num_proc: int):
    def formatting_prompts_func(examples):
        texts = [
            tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=False,
            )
            for messages in examples["messages"]
        ]
        return {"text": texts}

    return dataset.map(formatting_prompts_func, batched=True, num_proc=num_proc)


def build_training_args(args: argparse.Namespace, has_eval: bool) -> TrainingArguments:
    common: Dict[str, Any] = {
        "per_device_train_batch_size": args.batch_size,
        "gradient_accumulation_steps": args.gradient_accumulation_steps,
        "warmup_ratio": args.warmup_ratio,
        "num_train_epochs": args.epochs,
        "learning_rate": args.learning_rate,
        "fp16": not torch.cuda.is_bf16_supported(),
        "bf16": torch.cuda.is_bf16_supported(),
        "logging_steps": args.logging_steps,
        "optim": args.optim,
        "weight_decay": args.weight_decay,
        "lr_scheduler_type": args.lr_scheduler_type,
        "seed": args.seed,
        "output_dir": args.checkpoint_dir,
        "save_strategy": "steps",
        "save_steps": args.save_steps,
        "save_total_limit": args.save_total_limit,
        "report_to": "none",
    }
    if has_eval:
        common.update(
            {
                "eval_steps": args.eval_steps,
                "load_best_model_at_end": False,
                "metric_for_best_model": "eval_loss",
            }
        )
        try:
            return TrainingArguments(**common, eval_strategy="steps")
        except TypeError:
            return TrainingArguments(**common, evaluation_strategy="steps")
    try:
        return TrainingArguments(**common, eval_strategy="no")
    except TypeError:
        return TrainingArguments(**common, evaluation_strategy="no")


def build_trainer(
    *,
    model,
    tokenizer,
    train_dataset,
    eval_dataset,
    args: argparse.Namespace,
    training_args: TrainingArguments,
):
    trainer_kwargs: Dict[str, Any] = {
        "model": model,
        "train_dataset": train_dataset,
        "eval_dataset": eval_dataset,
        "dataset_text_field": "text",
        "max_seq_length": args.max_seq_length,
        "dataset_num_proc": args.dataset_num_proc,
        "packing": args.packing,
        "args": training_args,
    }

    try:
        trainer = SFTTrainer(tokenizer=tokenizer, **trainer_kwargs)
    except TypeError:
        trainer = SFTTrainer(processing_class=tokenizer, **trainer_kwargs)

    if args.responses_only:
        if train_on_responses_only is None:
            logger.warning("installed Unsloth lacks train_on_responses_only; training full prompt text")
        else:
            trainer = train_on_responses_only(
                trainer,
                instruction_part=args.instruction_part,
                response_part=args.response_part,
            )
    return trainer


def train(args: argparse.Namespace):
    train_file = Path(args.train_file)
    if not train_file.exists():
        raise FileNotFoundError(
            f"{train_file} does not exist. Run vetios_pipeline/prepare_dataset.py first."
        )

    if args.clinical_ack:
        logger.info("clinical data acknowledgement supplied")
    else:
        logger.warning(
            "clinical training data must be de-identified, licensed for this use, and approved for the runtime. "
            "Do not upload PHI or restricted datasets to Colab unless your data terms explicitly allow it."
        )

    os.makedirs(args.checkpoint_dir, exist_ok=True)
    os.makedirs(args.output_dir, exist_ok=True)

    logger.info("loading model: %s", args.model)
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=args.max_seq_length,
        dtype=None,
        load_in_4bit=args.load_in_4bit,
    )
    tokenizer = get_chat_template(tokenizer, chat_template=args.chat_template)

    logger.info("applying LoRA adapters")
    target_modules = list(TARGET_MODULES)
    if args.train_embeddings:
        target_modules.extend(["lm_head", "embed_tokens"])

    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_rank,
        target_modules=target_modules,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=args.seed,
        max_seq_length=args.max_seq_length,
        use_rslora=args.use_rslora,
    )

    logger.info("loading prepared datasets")
    train_dataset, eval_dataset = load_prepared_dataset(args.train_file, args.eval_file)
    train_dataset = apply_qwen_chat_template(train_dataset, tokenizer, args.dataset_num_proc)
    if eval_dataset is not None:
        eval_dataset = apply_qwen_chat_template(eval_dataset, tokenizer, args.dataset_num_proc)

    training_args = build_training_args(args, has_eval=eval_dataset is not None)
    trainer = build_trainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        args=args,
        training_args=training_args,
    )

    logger.info("starting SFT")
    trainer_stats = trainer.train(resume_from_checkpoint=args.resume_from_checkpoint or None)

    logger.info("saving adapter to %s", args.output_dir)
    model.save_pretrained(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)

    if args.push_to_hub:
        if not args.hub_model_id:
            raise ValueError("--hub-model-id is required with --push-to-hub")
        logger.info("pushing adapter to Hugging Face Hub: %s", args.hub_model_id)
        model.push_to_hub(args.hub_model_id)
        tokenizer.push_to_hub(args.hub_model_id)

    logger.info("training complete")
    return trainer_stats


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fine-tune VetIOS Qwen on prepared clinical SFT data.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Hugging Face model id or local model path")
    parser.add_argument("--train-file", default=DEFAULT_TRAIN_FILE)
    parser.add_argument("--eval-file", default=DEFAULT_EVAL_FILE)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--checkpoint-dir", default=DEFAULT_CHECKPOINT_DIR)
    parser.add_argument("--max-seq-length", type=int, default=4096)
    parser.add_argument("--load-in-4bit", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--chat-template", default="qwen2.5")
    parser.add_argument("--responses-only", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--instruction-part", default="<|im_start|>user\n")
    parser.add_argument("--response-part", default="<|im_start|>assistant\n")
    parser.add_argument("--lora-rank", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--use-rslora", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--train-embeddings", action="store_true")
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=4)
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--warmup-ratio", type=float, default=0.03)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--lr-scheduler-type", default="cosine")
    parser.add_argument("--optim", default="adamw_8bit")
    parser.add_argument("--logging-steps", type=int, default=5)
    parser.add_argument("--eval-steps", type=int, default=100)
    parser.add_argument("--save-steps", type=int, default=100)
    parser.add_argument("--save-total-limit", type=int, default=2)
    parser.add_argument("--dataset-num-proc", type=int, default=2)
    parser.add_argument("--packing", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--seed", type=int, default=3407)
    parser.add_argument("--resume-from-checkpoint", default="")
    parser.add_argument("--clinical-ack", action="store_true")
    parser.add_argument("--push-to-hub", action="store_true")
    parser.add_argument("--hub-model-id", default="")
    return parser


if __name__ == "__main__":
    train(build_parser().parse_args())

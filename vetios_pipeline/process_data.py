import os
import fitz  # PyMuPDF
from docx import Document
import logging
from tqdm import tqdm

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

RAW_DIR = "vetios_pipeline/raw_data"
PARSED_DIR = "vetios_pipeline/parsed_text"

os.makedirs(PARSED_DIR, exist_ok=True)

def extract_text_from_pdf(filepath):
    try:
        doc = fitz.open(filepath)
        text = ""
        for page in doc:
            page_text = page.get_text()
            if page_text.strip():
                text += page_text + "\n"
        return text
    except Exception as e:
        logger.error(f"Error extracting PDF {filepath}: {e}")
        return None

def extract_text_from_docx(filepath):
    try:
        doc = Document(filepath)
        return "\n".join([para.text for para in doc.paragraphs if para.text.strip()])
    except Exception as e:
        logger.error(f"Error extracting DOCX {filepath}: {e}")
        return None

def extract_text_from_txt(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()
    except Exception as e:
        logger.error(f"Error reading TXT {filepath}: {e}")
        return None

def run_extraction():
    all_files = []
    for root, _, files in os.walk(RAW_DIR):
        for file in files:
            all_files.append(os.path.join(root, file))
    
    logger.info(f"Found {len(all_files)} files in raw_data")
    
    processed_count = 0
    for filepath in tqdm(all_files, desc="Extracting text"):
        ext = os.path.splitext(filepath)[1].lower()
        text = None
        
        if ext == ".pdf":
            text = extract_text_from_pdf(filepath)
        elif ext == ".docx":
            text = extract_text_from_docx(filepath)
        elif ext == ".txt":
            text = extract_text_from_txt(filepath)
        
        if text:
            # Normalize whitespace
            text = "\n".join([line.strip() for line in text.splitlines() if line.strip()])
            
            relative_path = os.path.relpath(filepath, RAW_DIR).replace(os.sep, "_").replace(".", "_")
            output_filename = f"{relative_path}.txt"
            output_path = os.path.join(PARSED_DIR, output_filename)
            
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(text)
            processed_count += 1
            
    logger.info(f"Successfully processed {processed_count} files")

if __name__ == "__main__":
    run_extraction()

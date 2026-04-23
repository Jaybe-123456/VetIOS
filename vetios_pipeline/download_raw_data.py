import gdown
import os
import logging

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("vetios_pipeline/downloader.log"),
        logging.StreamHandler()
    ]
)

folders = [
    "https://drive.google.com/drive/folders/0B_KDAXN2DwKNflhVWmFBX0tmWDZtMXNnaFVLNkF6RGNxdDlGM21zdXhONnJEVVRrdnh0c28?resourcekey=0-9UNgZtFMOxkfoXElpBB6gQ",
    "https://drive.google.com/drive/folders/1ZiDgdB7_xnoYjwtddy8eJn0-pkuM5GJC",
    "https://drive.google.com/drive/folders/1aAR35jLNOs1EogZvw7tgBcPPXAIITvFl"
]

def download_folders():
    for i, folder_url in enumerate(folders):
        output_dir = f"vetios_pipeline/raw_data/folder_{i}"
        os.makedirs(output_dir, exist_ok=True)
        
        logging.info(f"Starting download of Folder {i}: {folder_url}")
        try:
            # gdown.download_folder handles recursive download by default if it's a folder URL
            gdown.download_folder(
                url=folder_url,
                output=output_dir,
                quiet=False,
                use_cookies=False
            )
            logging.info(f"Successfully downloaded Folder {i}")
        except Exception as e:
            logging.error(f"Failed to download Folder {i}: {str(e)}")

if __name__ == "__main__":
    download_folders()

import logging
import sys
import os

def setup_pipeline_logger(name: str, log_filename: str):
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)
    
    if not logger.handlers:
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        # PIPELINE_LOG_DIR points a run (the tests, a trial on copies) at another folder, so it adds nothing to logs/.
        logs_dir = os.environ.get("PIPELINE_LOG_DIR") or os.path.join(base_dir, "logs")
        os.makedirs(logs_dir, exist_ok=True)
        log_path = os.path.join(logs_dir, log_filename)
        
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
        file_handler.setLevel(logging.DEBUG)
        file_formatter = logging.Formatter('[%(asctime)s] %(levelname)s [%(name)s] - %(message)s')
        file_handler.setFormatter(file_formatter)
        
        console_handler = logging.StreamHandler(sys.stdout)
        # PIPELINE_CONSOLE_LEVEL (e.g. WARNING) quiets the console, as the tests do; the log file keeps everything.
        console_handler.setLevel(os.environ.get("PIPELINE_CONSOLE_LEVEL", "INFO").upper())
        console_formatter = logging.Formatter('[%(asctime)s] %(levelname)s [%(name)s] - %(message)s')
        console_handler.setFormatter(console_formatter)
        
        logger.addHandler(file_handler)
        logger.addHandler(console_handler)
        
    return logger

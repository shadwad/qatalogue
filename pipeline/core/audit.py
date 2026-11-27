import json
import os

# One line per merge decision. merge_entities.py starts it afresh each run, so it records the current decisions.
# MERGE_AUDIT_PATH in the environment points a run at another file.
AUDIT_FILE = os.environ.get("MERGE_AUDIT_PATH") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "logs", "merge_audit.jsonl")


def start_audit() -> None:
    os.makedirs(os.path.dirname(AUDIT_FILE), exist_ok=True)
    open(AUDIT_FILE, "w", encoding="utf-8").close()


def _audit(record: dict) -> None:
    with open(AUDIT_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")

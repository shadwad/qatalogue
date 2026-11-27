"""The generated location mapping (public/config/location_mapping.json): the name and world region of each location code in
the data, generated from CLDR metadata via `make locations`."""
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def mapping_path() -> str:
    """LOCATION_MAPPING_PATH points a trial build or a test at another file."""
    return os.environ.get('LOCATION_MAPPING_PATH') or os.path.join(ROOT, 'public', 'config', 'location_mapping.json')


def load_location_mapping(prefer_staged: bool = False) -> dict:
    path = mapping_path()
    if prefer_staged and os.path.exists(path + ".tmp"):
        path = path + ".tmp"
    try:
        with open(path, encoding='utf-8') as handle:
            return json.load(handle)
    except (OSError, ValueError) as error:
        raise RuntimeError(f"{path} is missing or unreadable ({error}). Run `make locations` first (it runs as the first step of `make database`).") from error

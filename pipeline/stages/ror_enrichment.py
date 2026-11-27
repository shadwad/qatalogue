import urllib.parse
from pipeline.db.connection import open_staging
from pipeline.clients.ror_client import bare_ror_id, extract_ror_country, fetch_ror_api
import logging

logger = logging.getLogger(__name__)
def search_ror_by_name(name):
    encoded = urllib.parse.quote(name)
    url = f"https://api.ror.org/organizations?query={encoded}"
    res = fetch_ror_api(url)
    if res and 'items' in res:
        return res['items'][:5]
    return []

def extract_names(item):
    names = []
    # ROR v2
    for n in item.get('names', []):
        if 'value' in n:
            names.append(n['value'].lower().strip())
    # ROR v1 fallback
    if 'name' in item:
        names.append(item['name'].lower().strip())
    for a in item.get('aliases', []):
        names.append(a.lower().strip())
    return names

def choose_ror(name: str, items: list[dict]) -> tuple[str, str] | None:
    """Return (bare_ror_id, location_code) when exactly one ROR record matches `name`, otherwise None."""
    target = (name or "").lower().strip()
    exact = [item for item in items if target and target in extract_names(item)]
    if len(exact) != 1:
        return None
    # Store bare id (e.g. "04eswfz98"); ROR API returns full URLs.
    ror = bare_ror_id(exact[0].get('id'))
    location = extract_ror_country(exact[0])
    return (ror, location) if ror and location else None


def enrich_missing_locations():
    logger.info("\n  STAGE: ROR Location Enrichment\n")
    corrections = 0
    with open_staging() as conn:
        c = conn.cursor()
        
        c.execute("""
            SELECT inst_id, display_name 
            FROM institutions 
            WHERE location_code IS NULL OR location_code = '' OR location_code = 'unknown'
        """)
        missing_insts = c.fetchall()
        
        logger.info(f"    [Enrichment] Found {len(missing_insts)} institutions missing location codes.")
        
        ambiguous = 0
        for inst_id, name in missing_insts:
            if not name:
                continue
            items = search_ror_by_name(name)
            choice = choose_ror(name, items)
            if choice is None:
                ambiguous += sum(1 for item in items if name.lower().strip() in extract_names(item)) > 1
                continue
            ror, location = choice
            logger.info(f"    [Enrichment] Resolved '{name}' to {location} ({ror})")
            c.execute("UPDATE institutions SET ror = ?, location_code = ? WHERE inst_id = ?", (ror, location, inst_id))
            corrections += 1
        if ambiguous:
            logger.info(f"    [Enrichment] Left {ambiguous} name(s) that several ROR organizations share unresolved")

    return corrections

if __name__ == "__main__":
    enrich_missing_locations()

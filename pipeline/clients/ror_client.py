import json
import logging
import re
import urllib.error
import urllib.parse

from pipeline.clients.http_retry import doubling, request
from pipeline.core.api_config import get_email
from pipeline.db import connection as db_conn

logger = logging.getLogger(__name__)


def bare_ror_id(raw: str | None) -> str | None:
    """Normalises a ROR identifier or URL to its bare id (or None if empty)."""
    if not raw:
        return None
    cleaned = re.sub(r'^https?://ror\.org/', '', raw.strip()).strip('/')
    return cleaned or None


def extract_ror_country(record: dict | None) -> str | None:
    """Reads the ISO country code from a ROR v2 or v1 organisation record."""
    if not record:
        return None
    for loc in record.get('locations') or []:
        cc = (loc.get('geonames_details') or {}).get('country_code')
        if cc:
            return cc
    return (record.get('country') or {}).get('country_code') or None


def extract_ror_coords(record: dict | None) -> tuple[float, float, str | None] | None:
    """Reads (lat, lng, city) from a ROR v2 or v1 organisation record."""
    if not record:
        return None
    for loc in record.get('locations') or []:
        g = loc.get('geonames_details') or {}
        if g.get('lat') is not None and g.get('lng') is not None:
            return float(g['lat']), float(g['lng']), g.get('name')
    for addr in record.get('addresses') or []:
        if addr.get('lat') is not None and addr.get('lng') is not None:
            city = addr.get('city') or (addr.get('geonames_city') or {}).get('city')
            return float(addr['lat']), float(addr['lng']), city
    return None


def init_ror_cache(conn):
    conn.execute('''
        CREATE TABLE IF NOT EXISTS ror_api_cache (
            url TEXT PRIMARY KEY,
            response TEXT
        )
    ''')


def fetch_ror_api(url):
    """ROR's answer for `url`, cached. None when ROR has no such record or rejects the request (404 and other 4xx,
    logged, not cached). Rate limits, server errors and dropped connections are retried (http_retry.request); once the
    retries run out it raises RetriesExhausted, so an outage stops the run instead of reading as "no match"."""
    with db_conn.open_cache() as conn:
        init_ror_cache(conn)
        row = conn.execute("SELECT response FROM ror_api_cache WHERE url=?", (url,)).fetchone()
        if row:
            return json.loads(row[0])
    try:
        data = request(url, headers={'User-Agent': f'Qatalogue (mailto:{get_email()})'}, attempts=4, pause=0.1,
                       backoff=doubling(start=2), parse=lambda body: json.loads(body.decode()))
    except urllib.error.HTTPError as e:
        logger.error(f"ROR API HTTP Error for {url}: {e}")
        return None
    with db_conn.open_cache() as conn:
        init_ror_cache(conn)
        conn.execute("INSERT OR REPLACE INTO ror_api_cache (url, response) VALUES (?, ?)", (url, json.dumps(data)))
    return data


def get_ror_profile(ror_id):
    clean_id = bare_ror_id(ror_id)
    if not clean_id:
        return None
    url = f"https://api.ror.org/organizations/{clean_id}"
    return fetch_ror_api(url)

def match_affiliation(affil_string):
    if not affil_string: return None
    encoded = urllib.parse.quote(affil_string)
    url = f"https://api.ror.org/organizations?affiliation={encoded}"
    return fetch_ror_api(url)

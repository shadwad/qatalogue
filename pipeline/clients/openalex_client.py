import json
import logging
import urllib.error
import urllib.parse

from pipeline.clients.http_retry import RetriesExhausted, request
from pipeline.core.api_config import get_api_key, get_email
from pipeline.db.connection import open_cache

logger = logging.getLogger("OpenAlex")

class OpenAlexClient:
    def __init__(self, email=None):
        if not email:
            email = get_email()
        self.base_url = "https://api.openalex.org"
        self.headers = {"User-Agent": f"Qatalogue (mailto:{email})"}
        self.api_key = get_api_key("openalex")
        if self.api_key:
            self.headers["Authorization"] = f"Bearer {self.api_key}"
        self.rate_limit_delay = 0.11 # 10 requests per second maximum

    def get_json(self, url: str, attempts: int = 6) -> dict | None:
        """GET with retries (http_retry.request): raises RetriesExhausted once they run out, so a caller never mistakes
        a failed fetch for an empty one. None for 404."""
        shown = url  # messages show the URL without the key
        if self.api_key:  # OpenAlex documents the key as a query parameter; the header is kept as well
            url = f"{url}{'&' if '?' in url else '?'}api_key={urllib.parse.quote(self.api_key)}"
        try:
            return request(url, headers=self.headers, attempts=attempts, pause=self.rate_limit_delay,
                           parse=lambda body: json.loads(body.decode("utf-8")), shown=shown)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise

    # OpenAlex serves page numbers up to 10,000 results without an API key; paging further with a cursor needs one.
    PAGE_LIMIT = 10_000

    def fetch_all(self, url: str) -> tuple[list[dict], int]:
        """Every result of a list query (with per-page=200), and OpenAlex's own count for the query.
        Pages by number, which needs no API key, and by cursor only past 10,000 results, which does.
        Results are de-duplicated by id, since the order can shift between pages. Not cached."""
        sep = "&" if "?" in url else "?"
        first = self.get_json(f"{url}{sep}page=1")
        if first is None:
            return [], 0
        count = first.get("meta", {}).get("count", 0)
        if count > self.PAGE_LIMIT:
            if not self.api_key:
                raise RuntimeError(f"{count:,} results is more than OpenAlex pages without an API key "
                                   f"({self.PAGE_LIMIT:,}); enable OPENALEX_API_KEY in .env")
            pages, cursor = [], "*"
            while cursor:
                data = self.get_json(f"{url}{sep}cursor={urllib.parse.quote(cursor)}")
                if data is None or not data.get("results"):
                    break
                pages.append(data["results"])
                cursor = data.get("meta", {}).get("next_cursor")
        else:
            per_page = len(first.get("results", [])) or 1
            pages = [first.get("results", [])]
            for page in range(2, -(-count // per_page) + 1):
                data = self.get_json(f"{url}{sep}page={page}")
                if data is None or not data.get("results"):
                    break
                pages.append(data["results"])
        items, seen = [], set()
        for results in pages:
            for item in results:
                if item.get("id") not in seen:
                    seen.add(item.get("id"))
                    items.append(item)
        return items, count

    def fetch_work(self, work_id: str) -> dict | None:
        """One work, fresh from OpenAlex. The single-work endpoint lists every author, where list queries stop at 100."""
        return self.get_json(f"{self.base_url}/works/{work_id}")

    def get_entity(self, entity_id: str) -> dict | None:
        """Fetch a single entity (author, institution, work). Cached, including "not found"; retried on rate limits."""
        if not entity_id:
            return None
        if not entity_id.startswith("http"):
            entity_id = f"{self.base_url}/{entity_id}"
        with open_cache() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS api_cache (url TEXT PRIMARY KEY, response TEXT)")
            row = conn.execute("SELECT response FROM api_cache WHERE url = ?", (entity_id,)).fetchone()
            if row:
                return None if row[0] is None else json.loads(row[0])
        try:
            data = self.get_json(entity_id)
        except (urllib.error.HTTPError, RetriesExhausted) as e:  # leave uncached so the next run asks again
            logger.error(f"Error fetching {entity_id}: {e}")
            return None
        self._save_cache(entity_id, data)
        return data

    def _save_cache(self, url: str, response_data):
        with open_cache() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS api_cache (url TEXT PRIMARY KEY, response TEXT)")
            conn.execute(
                "INSERT OR REPLACE INTO api_cache (url, response) VALUES (?, ?)",
                (url, json.dumps(response_data) if response_data is not None else None),
            )

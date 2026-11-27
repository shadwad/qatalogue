from contextlib import contextmanager
from pathlib import Path
import sqlite3
import os

# Base path relative to this file's location
STAGING_DB_PATH = os.environ.get("STAGING_DB_PATH", os.path.join(os.path.dirname(__file__), '../../data/staging.db'))
SERVE_DB_PATH = os.environ.get("SERVE_DB_PATH", os.path.join(os.path.dirname(__file__), '../../data/serve.db'))
CACHE_DB_PATH = os.environ.get("CACHE_DB_PATH", os.path.join(os.path.dirname(__file__), '../../data/api_cache.db'))

def get_staging_connection():
    conn = sqlite3.connect(STAGING_DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA cache_size=-64000;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    return conn

# The build writes the next serve.db here; check_build.py checks it and finalize_build.py moves it over SERVE_DB_PATH.
SERVE_TMP_PATH = SERVE_DB_PATH + ".tmp"


def connect_build(must_exist: bool = True) -> sqlite3.Connection:
    """The build's database (SERVE_TMP_PATH). build_canonical_facts.py creates it (must_exist=False); every later build
    step adds to it and fails if it is missing. No build step writes into the live serve.db: that only changes when
    finalize_build.py moves a checked build over it."""
    if must_exist and not os.path.exists(SERVE_TMP_PATH):
        raise FileNotFoundError(f"{SERVE_TMP_PATH} does not exist: run build_canonical_facts.py (make canonical) first")
    conn = sqlite3.connect(SERVE_TMP_PATH)
    conn.execute("PRAGMA cache_size=-64000;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    return conn

def get_cache_connection():
    conn = sqlite3.connect(CACHE_DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


@contextmanager
def _managed(conn: sqlite3.Connection):
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def open_staging():
    """Context manager over STAGING_DB_PATH that commits on clean exit and always closes."""
    with _managed(get_staging_connection()) as conn:
        yield conn


@contextmanager
def open_build(must_exist: bool = True):
    """Context manager over SERVE_TMP_PATH that commits on clean exit and always closes."""
    with _managed(connect_build(must_exist=must_exist)) as conn:
        yield conn


@contextmanager
def open_cache():
    """Context manager over CACHE_DB_PATH that commits on clean exit and always closes."""
    with _managed(get_cache_connection()) as conn:
        yield conn


@contextmanager
def open_readonly(db_path):
    """Read-only SQLite connection that always closes on exit."""
    conn = sqlite3.connect(f"{Path(db_path).resolve().as_uri()}?mode=ro", uri=True)
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    with open_staging() as conn:
        c = conn.cursor()
        c.executescript("""
    CREATE TABLE IF NOT EXISTS papers (
        paper_id TEXT PRIMARY KEY,
        title TEXT,
        year INTEGER,
        venue_id TEXT,
        venue_name TEXT,
        total_authors INTEGER,
        paper_score REAL,
        topics TEXT,
        doi TEXT,
        audit_status TEXT DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS authors (
        author_id TEXT PRIMARY KEY,
        name TEXT,
        orcid TEXT,
        canonical_author_id TEXT
    );
    -- Columns named openalex_* hold what OpenAlex returned and are written only by the import. Their working
    -- counterparts (author_id) and the canonical/corrected columns are decisions: merge_entities.py resets them from the
    -- openalex_* columns at the start of every run (pipeline/stages/reset.py) and decides them again.
    CREATE TABLE IF NOT EXISTS institutions (
        inst_id TEXT PRIMARY KEY,
        ror TEXT,
        openalex_id TEXT,
        display_name TEXT,
        location_code TEXT,
        canonical_inst_id TEXT
    );
    CREATE TABLE IF NOT EXISTS authorships (
        paper_id TEXT,
        author_id TEXT,
        raw_affiliation_string TEXT,     -- the author's affiliation as printed, as OpenAlex matched it to this institution
        openalex_institution_id TEXT,
        corrected_institution_id TEXT,
        score_share REAL,                -- unused: credit is computed at build time (build_canonical_facts.py)
        raw_affiliation_strings TEXT,    -- JSON list: every affiliation string printed for this author on this paper
        openalex_author_id TEXT,         -- the author as OpenAlex listed them; author_id is this unless an author was split
        UNIQUE(paper_id, author_id, openalex_institution_id)
    );
    -- What the import has fetched: one row per (venue, year), with the topic filter it was fetched with
    -- ('' for none), OpenAlex's count for that query, and how many papers were stored.
    CREATE TABLE IF NOT EXISTS fetch_shards (
        venue_id TEXT NOT NULL,
        year INTEGER NOT NULL,
        topic_filter TEXT NOT NULL,
        expected INTEGER NOT NULL,
        papers INTEGER NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (venue_id, year)
    );
    -- Decision table (pipeline/stages/duplicates.py): copies of a paper OpenAlex holds twice under one DOI. Cleared by
    -- reset.py and filled by merge_entities.py on every run; the raw papers and authorships keep every copy.
    CREATE TABLE IF NOT EXISTS duplicate_papers (
        paper_id TEXT PRIMARY KEY,
        canonical_paper_id TEXT NOT NULL,
        doi TEXT
    );

    -- Institutions recovered from the printed affiliation of an author row OpenAlex left without one
    -- (pipeline/stages/affiliations.py); a decision, refilled on every run.
    CREATE TABLE IF NOT EXISTS recovered_affiliations (
        paper_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        inst_id TEXT NOT NULL,
        raw_string TEXT,
        method TEXT NOT NULL,
        PRIMARY KEY (paper_id, author_id, inst_id)
    );
    CREATE TABLE IF NOT EXISTS data_revision (
        id INTEGER PRIMARY KEY,
        revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS rejected_merges (
        entity_type TEXT NOT NULL,
        id_1 TEXT NOT NULL,
        id_2 TEXT NOT NULL,
        score REAL,
        run_timestamp TEXT,
        PRIMARY KEY (entity_type, id_1, id_2)
    );
    INSERT OR IGNORE INTO data_revision (id, revision) VALUES (1, 1);

    -- Paper text & subject metadata (enrich_papers.py). Used for search and topic building, not displayed.
    CREATE TABLE IF NOT EXISTS paper_text (
        paper_id TEXT PRIMARY KEY,
        abstract_openalex TEXT,
        keywords TEXT,            -- JSON [[name, score], ...]
        concepts TEXT,            -- JSON [[id, name, level, score], ...]
        topics_detail TEXT,       -- JSON [{id, name, score, subfield, field, domain}, ...]
        openalex_status TEXT,     -- 'ok' | 'missing'
        openalex_fetched_at TEXT,
        arxiv_id TEXT,
        arxiv_title TEXT,
        arxiv_abstract TEXT,
        arxiv_primary TEXT,
        arxiv_categories TEXT,    -- JSON list, primary first
        arxiv_title_match REAL,   -- similarity of arXiv title to our title (0-1)
        arxiv_status TEXT,        -- 'ok' | 'missing' | 'mismatch'
        arxiv_fetched_at TEXT
    );
    -- One vector per paper (embed_papers.mjs). text_hash lets reruns skip unchanged papers.
    CREATE TABLE IF NOT EXISTS paper_embeddings (
        paper_id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        dim INTEGER NOT NULL,
        vec BLOB NOT NULL         -- little-endian float32, L2-normalised
    );

    -- Performance Indexes
    CREATE INDEX IF NOT EXISTS idx_authorships_raw_affil ON authorships(raw_affiliation_string);
    CREATE INDEX IF NOT EXISTS idx_authorships_author ON authorships(author_id);
    CREATE INDEX IF NOT EXISTS idx_authorships_paper ON authorships(paper_id);
    CREATE INDEX IF NOT EXISTS idx_authorships_inst_paper ON authorships(corrected_institution_id, openalex_institution_id, paper_id);
    CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);
    CREATE INDEX IF NOT EXISTS idx_papers_venue_year ON papers(venue_name, year);
    CREATE INDEX IF NOT EXISTS idx_authors_orcid ON authors(orcid);
    CREATE INDEX IF NOT EXISTS idx_authors_canonical ON authors(canonical_author_id);
    CREATE INDEX IF NOT EXISTS idx_inst_canonical ON institutions(canonical_inst_id);
    """)
        # Columns added after a table was first created.
        added_now = set()
        for table, added in (("paper_text", ("work_type", "work_type_crossref")),   # OpenAlex type (article, review, editorial, ...)
                             ("authorships", ("raw_affiliation_strings", "openalex_author_id"))):
            cols = {r[1] for r in c.execute(f"PRAGMA table_info({table})")}
            for col in added:
                if col not in cols:
                    c.execute(f"ALTER TABLE {table} ADD COLUMN {col} TEXT")
                    added_now.add(col)
        # Rows imported before the openalex_* columns existed, filled once when the columns are added.
        # A split author's id is the original plus "_split_<n>".
        if "openalex_author_id" in added_now:
            c.execute("""UPDATE authorships SET openalex_author_id = CASE WHEN instr(author_id, '_split_') > 0
                         THEN substr(author_id, 1, instr(author_id, '_split_') - 1) ELSE author_id END""")

def init_cache_db():
    with open_cache() as conn:
        conn.executescript("""
    CREATE TABLE IF NOT EXISTS api_cache (
        url TEXT PRIMARY KEY,
        response TEXT
    );
    CREATE TABLE IF NOT EXISTS ror_api_cache (
        url TEXT PRIMARY KEY,
        response TEXT
    );
    """)

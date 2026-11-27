"""
The corpus the pipeline fetches and serves: the publication years, the venues, and the OpenAlex topics that select papers in
venues that also publish outside the field. pipeline/config/scope.json is the one place to change any of them.

Each (venue, year) is a shard: the unit the import fetches and records. Widening the years or adding a venue adds shards, so
only those are fetched. Narrowing the scope removes nothing from staging; the build serves only papers inside it.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# SCOPE_PATH in the environment points a run at another scope file, as STAGING_DB_PATH does for the database.
SCOPE_PATH = Path(os.environ.get('SCOPE_PATH') or Path(__file__).resolve().parents[1] / 'config' / 'scope.json')

_VENUE_ID = re.compile(r'^S\d+$')
_TOPIC_ID = re.compile(r'^T\d+$')


@dataclass(frozen=True)
class Venue:
    openalex_id: str
    name: str
    # True for venues that publish beyond quantum information: only papers in the corpus topics are fetched from them.
    requires_topic_filter: bool


@dataclass(frozen=True)
class Scope:
    start_year: int
    end_year: int
    venues: tuple[Venue, ...]
    corpus_topics: tuple[tuple[str, str], ...]  # (OpenAlex id, name)

    @property
    def years(self) -> range:
        return range(self.start_year, self.end_year + 1)

    def topic_filter(self, venue: Venue) -> str:
        """The OpenAlex topics a venue is fetched with, as one filter value; '' when the venue takes every paper."""
        return '|'.join(sorted(t for t, _ in self.corpus_topics)) if venue.requires_topic_filter else ''

    def papers_sql(self, alias: str = '') -> str:
        """SQL condition that keeps a staging paper only if it is inside the scope. Ids are validated, so inlining is safe."""
        p = f'{alias}.' if alias else ''
        ids = ', '.join(f"'{v.openalex_id}'" for v in self.venues)
        return f'{p}venue_id IN ({ids}) AND {p}year BETWEEN {self.start_year} AND {self.end_year}'


def load_scope(path: Path = SCOPE_PATH) -> Scope:
    """Reads and checks the scope file; raises ValueError naming the first problem."""
    raw = json.loads(Path(path).read_text(encoding='utf-8'))
    years = raw.get('years') or {}
    start, end = years.get('start'), years.get('end')
    if (not isinstance(start, int) or isinstance(start, bool)
            or not isinstance(end, int) or isinstance(end, bool) or start > end):
        raise ValueError(f'{path}: years must be whole numbers with start <= end, got {years!r}')

    topics = []
    for t in raw.get('corpus_topics') or []:
        tid = str(t.get('openalex_id', '')).split('/')[-1]
        if not _TOPIC_ID.match(tid) or not t.get('name'):
            raise ValueError(f'{path}: corpus topic needs an OpenAlex id like T10020 and a name, got {t!r}')
        topics.append((tid, t['name']))
    if len({t for t, _ in topics}) != len(topics):
        raise ValueError(f'{path}: a corpus topic is listed twice')

    venues = []
    for v in raw.get('venues') or []:
        vid = str(v.get('openalex_id', '')).split('/')[-1]
        if not _VENUE_ID.match(vid) or not v.get('name'):
            raise ValueError(f'{path}: venue needs an OpenAlex source id like S24807848 and a name, got {v!r}')
        venues.append(Venue(vid, v['name'], bool(v.get('requires_topic_filter'))))
    if not venues:
        raise ValueError(f'{path}: no venues')
    if len({v.openalex_id for v in venues}) != len(venues):
        raise ValueError(f'{path}: a venue is listed twice')
    if any(v.requires_topic_filter for v in venues) and not topics:
        raise ValueError(f'{path}: venues need a topic filter but there are no corpus topics')

    return Scope(start, end, tuple(venues), tuple(topics))


def venues_catalog(scope: Scope) -> list[dict]:
    """The venue list the site reads (public/config/venues.json), written when a build is published."""
    return [{'name': v.name, 'openalex_id': v.openalex_id, 'requires_topic_filter': v.requires_topic_filter}
            for v in scope.venues]


def corpus_catalog(scope: Scope) -> dict:
    """What the site says about the corpus (public/config/corpus.json): the years, venues and corpus topics."""
    return {
        'years': {'start': scope.start_year, 'end': scope.end_year},
        'venues': [{'name': v.name, 'openalex_id': v.openalex_id} for v in scope.venues],
        'corpus_topics': [{'name': name, 'openalex_id': tid} for tid, name in scope.corpus_topics],
    }

"""Placeholder author names (e.g., "Anonymous").

Placeholder records are never merged and are excluded from researcher lists, search, and researcher counts,
while their authorships still count toward paper totals and institutional attribution.
"""
import re
import unicodedata

PLACEHOLDER_NAMES = frozenset({
    "anonymous",
    "anon",
    "unknown",
    "unknown author",
    "author unknown",
    "no author",
    "not available",
    "n a",
    "na",
    "none",
    "null",
    "et al",
})


def normalise_name(name: str | None) -> str:
    """Casefold and strip punctuation while preserving letters across non-Latin scripts (Cyrillic, CJK, Greek)."""
    if not name:
        return ""
    folded = unicodedata.normalize("NFKC", name).casefold()
    return " ".join(re.sub(r"[\W_]+", " ", folded).split())


def is_placeholder_name(name: str | None) -> bool:
    """True for empty names and known stand-ins like 'Anonymous', '[anonymous]', 'N/A'."""
    normalised = normalise_name(name)
    return normalised == "" or normalised in PLACEHOLDER_NAMES

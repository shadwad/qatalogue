import unicodedata
import re

try:
    from rapidfuzz import fuzz
    from rapidfuzz.distance import JaroWinkler
    HAS_RAPIDFUZZ = True
except ImportError:
    HAS_RAPIDFUZZ = False

def name_parts(name: str) -> list[str]:
    """
    Normalise to ASCII, lowercase, strip punctuation, return tokens in
    [given..., family] order regardless of input convention.
    """
    if not name:
        return []
    name = (unicodedata.normalize("NFKD", name)
                       .encode("ASCII", "ignore")
                       .decode()
                       .lower())
    if "," in name:
        last_raw, first_raw = name.split(",", 1)
        last  = re.sub(r"[^a-z0-9\s]", "", last_raw).split()
        first = re.sub(r"[^a-z0-9\s]", "", first_raw).split()
        return first + last   # → [given..., family]
    return re.sub(r"[^a-z0-9\s]", "", name).split()


def names_match(p1: list[str], p2: list[str]) -> bool:
    """Compare normalized name token lists using RapidFuzz Jaro-Winkler (>= 93.0) or structural initial matching."""
    if not p1 or not p2:
        return False
    if p1 == p2:
        return True

    if HAS_RAPIDFUZZ:
        s1 = " ".join(p1)
        s2 = " ".join(p2)
        if JaroWinkler.similarity(s1, s2) * 100 >= 93.0:
            return True

    # Structural initials-aware fallback when RapidFuzz is unavailable or below threshold.
    if p1[-1] != p2[-1]:
        return False
    g1, g2 = p1[:-1], p2[:-1]
    if not g1 or not g2:
        return True   # bare surname wildcard
    for a, b in zip(g1, g2):
        if len(a) == 1 or len(b) == 1:
            if a[0] != b[0]:
                return False
        elif a != b:
            if HAS_RAPIDFUZZ and fuzz.ratio(a, b) > 85.0:
                continue
            return False
    return True


def names_match_with_inversion(p1: list[str], p2: list[str]) -> bool:
    """
    Extends names_match with a family/given swap to handle naming conventions
    where no comma separator was preserved (East-Asian, Hungarian, etc.).
    """
    if names_match(p1, p2):
        return True
    if not p1 or not p2:
        return False
    p1_inv = [p1[-1]] + p1[:-1]
    p2_inv = [p2[-1]] + p2[:-1]
    return names_match(p1_inv, p2) or names_match(p1, p2_inv)


# ── Whole-group name test (used by pairwise_scoring.apply_scored_merges) ───────────────────────────────────────────

def name_tokens(name: str | None) -> list[str]:
    """Return lowercase ASCII tokens in `[given..., family]` order, joining hyphenated segments within a part."""
    text = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    if "," in text:
        family, given = text.split(",", 1)
        text = f"{given} {family}"
    text = re.sub(r"[^a-z ]", " ", text.replace(".", " ").replace("-", ""))
    return text.split()


def given_names(name: str | None) -> list[str]:
    return name_tokens(name)[:-1]


def is_initials(given: list[str]) -> bool:
    """Return True when `given` is empty or contains single-letter initials only."""
    return all(len(part) == 1 for part in given)


def could_be_one_person(a: list[str], b: list[str]) -> bool:
    """Return True when two full given-name token lists match by prefix (joined) or first token."""
    joined_a, joined_b = "".join(a), "".join(b)
    return joined_a.startswith(joined_b) or joined_b.startswith(joined_a) or a[0] == b[0]


def same_name(a: str | None, b: str | None) -> bool:
    """Return True when two names share a family token and compatible given tokens or initials."""
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb or ta[-1] != tb[-1]:
        return False
    ga, gb = ta[:-1], tb[:-1]
    if not ga or not gb:
        return True
    if is_initials(ga) or is_initials(gb):
        return ga[0][0] == gb[0][0]
    return could_be_one_person(ga, gb)

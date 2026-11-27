import re
import unicodedata

INSTITUTION_STOP_WORDS = frozenset({
    "the", "and", "for", "university", "institute", "technology",
    "college", "department", "school", "center", "centre",
    "laboratory", "national", "state", "society", "research", "of",
    "sciences", "science", "faculty", "hospital", "academy", "polytechnic",
})

def core_words(name: str) -> set[str]:
    words = re.findall(r"\b[a-z]{3,}\b", name.lower())
    return {w for w in words if w not in INSTITUTION_STOP_WORDS}

def ngrams(text: str, n=3):
    text = re.sub(r'[^a-z0-9]', '', text.lower())
    if len(text) < n: return {text}
    return {text[i:i+n] for i in range(len(text)-n+1)}

def jaccard_sim(s1: str, s2: str) -> float:
    n1, n2 = ngrams(s1), ngrams(s2)
    if not n1 or not n2: return 0.0
    return len(n1.intersection(n2)) / len(n1.union(n2))

def is_subset_name(short: str, long: str) -> bool:
    """True if every core word of *short* appears in *long*, or high n-gram overlap."""
    ws, wl = core_words(short), core_words(long)
    if ws and wl and ws.issubset(wl):
        return True
    return jaccard_sim(short, long) > 0.65

# Generic words that don't tell institutions apart, in the languages institution names come in.
GENERIC_NAME_WORDS = INSTITUTION_STOP_WORDS | frozenset({
    "universite", "universitat", "universidad", "universita", "universidade", "universiteit", "uniwersytet",
    "institut", "instituto", "istituto", "instytut", "de", "del", "des", "di", "du", "la", "le", "der", "fur", "und",
    "et", "y", "e", "at", "in",
})


def _ascii(text: str) -> str:
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()


def name_words(name: str) -> frozenset[str]:
    """The words that identify an institution: accents, punctuation, word order and generic words left out."""
    return frozenset(w for w in re.findall(r"[a-z0-9]+", _ascii(name)) if w not in GENERIC_NAME_WORDS)


def same_institution_name(a: str, b: str, allow_suffix: bool = False) -> bool:
    """
    Return True when normalized identifying words (`name_words`) match exactly.

    With `allow_suffix=True`, one side may include a trailing ` - ` or `,` branch suffix when
    the base name matches; distinct suffixes on both sides never match.
    """
    wa, wb = name_words(a), name_words(b)
    if wa and wa == wb:
        return True
    if not wa and not wb:
        return _ascii(a).strip() == _ascii(b).strip() != ""
    if allow_suffix:
        split = lambda n: re.split(r"\s+-\s+|,", n, maxsplit=1)
        pa, pb = split(a), split(b)
        if len(pa) > 1 and len(pb) > 1:
            return False
        ba, bb = name_words(pa[0]), name_words(pb[0])
        return bool(ba) and ba == bb
    return False

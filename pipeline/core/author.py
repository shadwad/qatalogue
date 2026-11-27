from dataclasses import dataclass, field
from pipeline.core.disambiguation import name_parts

@dataclass
class AuthorRecord:
    id:          str
    name:        str
    orcid:       str | None        = None
    inst_ids:    set[str]          = field(default_factory=set)
    coauthors:   set[str]          = field(default_factory=set)
    concepts:    set[str]          = field(default_factory=set)
    name_parts:  list[str]         = field(default_factory=list)
    paper_ids:   set[str]          = field(default_factory=set)

    def __post_init__(self):
        self.name_parts = name_parts(self.name)

@dataclass
class MergeCandidate:
    id_keep:   str        # canonical / surviving author ID
    id_merge:  str        # author ID to be redirected
    score:     float
    reasons:   list[str]  # human-readable evidence trail

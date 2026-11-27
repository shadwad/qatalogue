import logging
from collections import defaultdict

from pipeline.core.institutions import is_subset_name

logger = logging.getLogger(__name__)

def collapse_paper_local_institutions() -> list:
    """
    On any paper with >1 distinct institution, collapse a truncated institution
    name into its ORCID-verified superset for the same author on the same paper.
    Returns a list of (paper_id, author_id, old_inst_id, new_inst_id) corrections.
    """
    paper_data: dict[str, list] = defaultdict(list)
    from pipeline.db.institution_repo import get_paper_local_institutions
    for row in get_paper_local_institutions():
        paper_data[row[0]].append({
            "author_id": row[1], "orcid": row[2],
            "inst_id":   row[3], "inst_name": row[4], "ror": row[5],
        })
    corrections = []
    for paper_id, records in paper_data.items():
        # Identify ORCID-confirmed institution records on this paper
        verified: list[dict] = []
        for r in records:
            if not (r["orcid"] and r["ror"]):
                continue
            
            verified.append(r)

        if not verified:
            continue

        verified_ids = {v["inst_id"] for v in verified}
        for r in records:
            if r["inst_id"] in verified_ids:
                continue
            for v in verified:
                if (r["author_id"] == v["author_id"]
                        and r["inst_name"] and v["inst_name"]
                        and is_subset_name(r["inst_name"], v["inst_name"])):
                    logger.debug(f"    [Paper-Local] Paper {paper_id}: "
                          f"'{r['inst_name']}' → '{v['inst_name']}'")
                    corrections.append((paper_id, r['author_id'], r['inst_id'], v["inst_id"]))
                    break
    return corrections


def merge_global_institutions_fuzzy() -> dict:
    """
    Fuzzy-merge institutions globally within the same location code when names match
    after normalization, acting as a fallback when ROR links are absent.
    """
    from pipeline.db.institution_repo import get_all_institutions
    from pipeline.core.institutions import same_institution_name
        
    insts = get_all_institutions() # (inst_id, ror, openalex_id, display_name, location_code)
        
    location_blocks = defaultdict(list)
    for row in insts:
        if row[3] and row[4]:
            location_blocks[row[4]].append(row)
                
    merges = {}
    for cc, block in location_blocks.items():
        if len(block) < 2:
            continue
                    
        for i in range(len(block)):
            for j in range(i+1, len(block)):
                i1, i2 = block[i], block[j]
                
                # Skip when both carry distinct ROR IDs.
                if i1[1] and i2[1] and i1[1] != i2[1]:
                    continue
                
                if same_institution_name(i1[3], i2[3]):
                    keep, merge = (i1[0], i2[0]) if (len(i1[3]), i1[0]) > (len(i2[3]), i2[0]) else (i2[0], i1[0])
                    merges[merge] = keep
                    logger.debug(f"    [Fuzzy Global] Global Inst Merge ({cc}): '{i1[3]}' and '{i2[3]}' -> kept {keep}")
                    
    return merges

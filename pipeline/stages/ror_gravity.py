import logging
import math
from collections import defaultdict

from pipeline.clients.ror_client import bare_ror_id, extract_ror_coords, extract_ror_country, get_ror_profile
from pipeline.core.institutions import same_institution_name
from pipeline.db.institution_repo import get_author_inst_histories

logger = logging.getLogger('merge.ror_gravity')


def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = (math.sin(dLat/2) * math.sin(dLat/2) +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dLon/2) * math.sin(dLon/2))
    a = min(1.0, max(0.0, a))
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

# An author's papers at one of two same-named institutions move to the other only when the other holds at least this many
# times as many of the author's papers. Near ties are left as OpenAlex has them.
GRAVITY_MARGIN = 2


def gravity_direction(r1, r2):
    """(keep, merge) for two of an author's institution records (author, inst_id, name, location, papers, ror), or None
    when neither holds a clear majority of the author's papers."""
    if r1[4] >= GRAVITY_MARGIN * r2[4]:
        return r1, r2
    if r2[4] >= GRAVITY_MARGIN * r1[4]:
        return r2, r1
    return None


def run_ror_phases():
    logger.info("\n  STAGE: ROR Gravity Correction\n")
    histories = get_author_inst_histories()
    
    auth_blocks = defaultdict(list)
    for row in histories:
        auth_blocks[row[0]].append(row)
        
    author_inst_merges = []
    gravity_anomalies = 0
    profiles: dict[str, dict | None] = {}

    def profile(ror: str) -> dict | None:
        if ror not in profiles:
            profiles[ror] = get_ror_profile(ror)
        return profiles[ror]

    for auth_id, records in auth_blocks.items():
        if len(records) < 2:
            continue
            
        for i in range(len(records)):
            for j in range(i+1, len(records)):
                r1, r2 = records[i], records[j]
                
                ror1, ror2 = r1[5], r2[5]
                if not ror1 or not ror2 or ror1 == ror2:
                    continue

                # Match normalized display names before fetching ROR profiles.
                if not r1[2] or not r2[2] or not same_institution_name(r1[2], r2[2], allow_suffix=True):
                    continue
                    
                p1 = profile(ror1)
                p2 = profile(ror2)
                
                if not p1 or not p2:
                    continue
                    
                c1 = extract_ror_country(p1)
                c2 = extract_ror_country(p2)

                is_distant = False
                if c1 and c2 and c1 != c2:
                    is_distant = True
                else:
                    coord1 = extract_ror_coords(p1)
                    coord2 = extract_ror_coords(p2)
                    if coord1 and coord2 and haversine(coord1[0], coord1[1], coord2[0], coord2[1]) > 5000:
                        is_distant = True

                if not is_distant:
                    continue

                r2_clean = bare_ror_id(ror2)
                related = any(bare_ror_id(rel.get('id')) == r2_clean for rel in p1.get('relationships', []))
                        
                if not related:
                    # Keep the institution holding most of the author's papers (field 4; field 3 is the location).
                    direction = gravity_direction(r1, r2)
                    if direction is None:
                        continue
                    (keep_r, merge_r) = direction
                    keep, merge = keep_r[1], merge_r[1]
                    keep_name, merge_name = keep_r[2], merge_r[2]
                    keep_c, merge_c = (c1, c2) if keep_r is r1 else (c2, c1)

                    author_inst_merges.append((auth_id, merge, keep))
                    gravity_anomalies += 1
                    logger.info(f"      Gravity Fix (Author {auth_id}): '{merge_name}' ({merge_c}) merged into '{keep_name}' ({keep_c})")
                    
    logger.info(f"  ✓  Geographic Gravity Anomalies resolved: {gravity_anomalies} anomalies")
    return author_inst_merges


def correct_author_gravity_fallback() -> list[tuple]:
    """
    Identify and correct cross-location twin misattributions based on author history.
    Acts as a fallback for cross-location anomalies where at least one side lacks a ROR ID.
    """
    histories = get_author_inst_histories()
    auth_blocks = defaultdict(list)
    for row in histories:
        auth_blocks[row[0]].append(row)

    author_inst_merges = []
    for auth_id, records in auth_blocks.items():
        if len(records) < 2:
            continue
        for i in range(len(records)):
            for j in range(i + 1, len(records)):
                r1, r2 = records[i], records[j]
                if r1[3] and r2[3] and r1[3] != r2[3] and r1[2] and r2[2] and same_institution_name(r1[2], r2[2], allow_suffix=True):
                    # If both have ROR IDs, run_ror_phases already decided them; fallback applies when at least one lacks a ROR ID.
                    if r1[5] and r2[5]:
                        continue
                    direction = gravity_direction(r1, r2)
                    if direction is None:
                        continue
                    keep, merge = direction[0][1], direction[1][1]
                    author_inst_merges.append((auth_id, merge, keep))
                    logger.debug(f"    [Gravity Fallback] Gravity Anomaly Fixed for author {auth_id}: '{r1[2]}' ({r1[3]}) vs '{r2[2]}' ({r2[3]}) -> kept {keep}")
    return author_inst_merges

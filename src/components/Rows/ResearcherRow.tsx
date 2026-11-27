import React, { useCallback } from 'react';
import type { AuthorInstitutionsResponse, ResearcherEntry } from '../../types';
import { EntityRow, type RowChildItem } from './EntityRow';
import { buildDetailUrl, fetchDetail, getAuthorLink, getInstitutionLink, type DetailFilterParams } from './utils';

interface ResearcherRowProps {
  inst: ResearcherEntry;
  index: number;
  isExpanded: boolean;
  toggleRow: (uniqueKey: string) => void;
}

export const ResearcherRow: React.FC<ResearcherRowProps> = React.memo(({
  inst,
  index,
  isExpanded,
  toggleRow,
}) => {
  // Location filtering for researchers matches their latest affiliation rather than individual historical papers,
  // so sub-rows omit location to avoid hiding historical affiliations/papers already counted in their total.
  const fetchChildren = useCallback(async (filters: DetailFilterParams, signal: AbortSignal): Promise<RowChildItem[]> => {
    const requestUrl = buildDetailUrl('/api/institutions', { author_id: inst.author_id }, filters, false);
    const json = await fetchDetail<AuthorInstitutionsResponse>(requestUrl, signal);
    return (Array.isArray(json.institutions) ? json.institutions : []).map(item => ({
      id: item.institution_id || item.openalex_id || item.institution_name,
      name: item.institution_name,
      link: getInstitutionLink(item),
      profileLabel: 'institution',
      score: Number(item.fractional_score),
    }));
  }, [inst.author_id]);

  const buildPapersUrl = useCallback(
    (institutionId: string, filters: DetailFilterParams) =>
      buildDetailUrl('/api/papers', { author_id: inst.author_id, inst_id: institutionId }, filters, false),
    [inst.author_id],
  );

  return (
    <EntityRow
      viewMode="researcher"
      uniqueKey={inst.author_id}
      index={index}
      isExpanded={isExpanded}
      toggleRow={toggleRow}
      primaryName={String(inst.author_name ?? inst.author_id ?? 'Unknown')}
      primaryLink={getAuthorLink(inst)}
      primaryProfileLabel="author"
      secondaryText={inst.latest_affiliation ?? ''}
      score={inst.total_fractional_score}
      childrenNoun="Institutions"
      includeLocations={false}
      canFetchChildren={Boolean(inst.author_id)}
      fetchChildren={fetchChildren}
      buildPapersUrl={buildPapersUrl}
    />
  );
});

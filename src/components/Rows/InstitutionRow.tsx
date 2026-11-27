import React, { useCallback } from 'react';
import type { FacultyResponse, InstitutionEntry } from '../../types';
import { EntityRow, type RowChildItem } from './EntityRow';
import { buildDetailUrl, fetchDetail, getAuthorLink, getInstitutionLink, type DetailFilterParams } from './utils';

interface InstitutionRowProps {
  inst: InstitutionEntry;
  index: number;
  isExpanded: boolean;
  toggleRow: (uniqueKey: string) => void;
}

export const InstitutionRow: React.FC<InstitutionRowProps> = React.memo(({
  inst,
  index,
  isExpanded,
  toggleRow,
}) => {
  const uniqueKey = inst.institution_id || inst.institution_name;

  const fetchChildren = useCallback(async (filters: DetailFilterParams, signal: AbortSignal): Promise<RowChildItem[]> => {
    const requestUrl = buildDetailUrl('/api/faculty', { inst_id: inst.institution_id }, filters, true);
    const json = await fetchDetail<FacultyResponse>(requestUrl, signal);
    return (Array.isArray(json.faculty) ? json.faculty : []).map(f => ({
      id: f.author_id,
      name: f.author_name ?? f.author_id,
      link: getAuthorLink(f),
      profileLabel: 'author',
      score: Number(f.fractional_score),
    }));
  }, [inst.institution_id]);

  const buildPapersUrl = useCallback(
    (authorId: string, filters: DetailFilterParams) =>
      buildDetailUrl('/api/papers', { author_id: authorId, inst_id: inst.institution_id }, filters, true),
    [inst.institution_id],
  );

  return (
    <EntityRow
      viewMode="institution"
      uniqueKey={uniqueKey}
      index={index}
      isExpanded={isExpanded}
      toggleRow={toggleRow}
      primaryName={String(inst.institution_name ?? inst.institution_id ?? 'Unknown')}
      primaryLink={getInstitutionLink(inst)}
      primaryProfileLabel="institution"
      secondaryText={inst.location}
      score={inst.total_fractional_score}
      childrenNoun="Researchers"
      includeLocations
      canFetchChildren={Boolean(inst.institution_id)}
      fetchChildren={fetchChildren}
      buildPapersUrl={buildPapersUrl}
    />
  );
});

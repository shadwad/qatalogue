import React from 'react';
import { isResearcherEntry, type ExplorerEntry } from '../../types';
import { InstitutionRow } from '../Rows/InstitutionRow';
import { ResearcherRow } from '../Rows/ResearcherRow';

interface ExplorerRowProps {
  inst: ExplorerEntry;
  index: number;
  isExpanded: boolean;
  toggleRow: (uniqueKey: string) => void;
}

export const ExplorerRow: React.FC<ExplorerRowProps> = React.memo(({
  inst,
  index,
  isExpanded,
  toggleRow,
}) => {
  if (isResearcherEntry(inst)) {
    return <ResearcherRow inst={inst} index={index} isExpanded={isExpanded} toggleRow={toggleRow} />;
  }

  return <InstitutionRow inst={inst} index={index} isExpanded={isExpanded} toggleRow={toggleRow} />;
});

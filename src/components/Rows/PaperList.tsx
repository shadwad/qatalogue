import { sanitizePaperTitle } from '../../lib/sanitizeHtml';
import { paperLink, type MetricMode, type Paper } from '../../types';
import { LOADING } from '../../lib/messages';
import { CONTROL_FOCUS } from '../ui/Controls';
import { LoadFailure } from '../ui/LoadFailure';
import { Shimmer } from '../ui/Shimmer';
import { Tooltip } from '../ui/Tooltip';
import { paperMetricScore } from './utils';

interface PaperListProps {
  papers: Paper[] | undefined;
  failed: boolean;
  metricMode: MetricMode;
  onRetry: () => void;
}

export function PaperList({ papers, failed, metricMode, onRetry }: PaperListProps) {
  if (!papers) {
    return failed
      ? <div className="mt-3 ml-6"><LoadFailure what="Papers" size="nested" onRetry={onRetry} /></div>
      : <Shimmer as="div" className="w-fit font-mono text-[11px] uppercase tracking-wider mt-3 ml-6">{LOADING.detail}</Shimmer>;
  }
  if (papers.length === 0) {
    return <div className="text-xs text-on-surface-variant mt-3 ml-6">No papers match these filters.</div>;
  }
  return (
    <div className="mt-3 ml-2 @2xl/results:ml-6 mb-2 flex flex-col gap-3">
      {papers.map((p, pIndex) => {
        const link = paperLink(p);
        return (
        <div key={p.paper_id || pIndex} className="flex justify-between items-start text-xs text-on-surface-variant/80">
          <div className="pr-4 leading-relaxed">
            <Tooltip content={link.label}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`${CONTROL_FOCUS} rounded-sm text-on-surface-variant hover:text-primary transition-colors hover:underline decoration-outline underline-offset-2`}
                onClick={(e) => e.stopPropagation()}
                dangerouslySetInnerHTML={{ __html: sanitizePaperTitle(p.title) }}
              />
            </Tooltip>
            <div className="text-xs mt-0.5 text-on-surface-variant font-sans">
              {p.venue_name}{p.year != null && <> <span className="font-mono opacity-80">({p.year})</span></>}
            </div>
          </div>
          {metricMode !== 'none' && (
            <span className="font-mono text-[10px]">
              {paperMetricScore(p, metricMode).toFixed(2)}
            </span>
          )}
        </div>
        );
      })}
    </div>
  );
}

export default PaperList;

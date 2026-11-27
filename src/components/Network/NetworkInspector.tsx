import { X } from 'lucide-react';
import { entryName, entrySecondary, metricLabel } from '../../hooks/useExplorerData';
import type { ExplorerEntry, MetricMode } from '../../types';
import { metricShortPrefix } from '../Rows/utils';
import { Tooltip } from '../ui/Tooltip';
import { CONTROL_FOCUS } from '../ui/Controls';
import type { LinkedPairs, NodeStats } from './graph';
import { keyLinkLine, type GeoPosition } from './types';

interface NetworkInspectorProps {
  focusId: string;
  entry: ExplorerEntry;
  stats: NodeStats;
  linked: LinkedPairs | null;
  position: GeoPosition | undefined;
  strongestTies: { id: string; name: string; papers: number }[];
  colour: string | undefined;
  cardIsSelection: boolean;
  isMap: boolean;
  metricMode: MetricMode;
  onClearSelection: () => void;
  onOpenInList: (id: string) => void;
}

export function NetworkInspector({
  focusId,
  entry,
  stats,
  linked,
  position,
  strongestTies,
  colour,
  cardIsSelection,
  isMap,
  metricMode,
  onClearSelection,
  onOpenInList,
}: NetworkInspectorProps) {
  const secondary = entrySecondary(entry);

  return (
    <div
      className={`absolute bottom-3 inset-x-3 md:inset-x-auto md:bottom-4 md:right-[clamp(1.5rem,4vw,2.5rem)] md:w-[260px] md:max-h-[calc(100%-4.75rem)] md:pointer-coarse:max-h-[calc(100%-5.5rem)] md:overflow-y-auto z-10 bg-surface border rounded-xl shadow-popover p-3 md:p-4 ${
        cardIsSelection ? 'border-primary/40 pointer-events-auto' : 'border-outline pointer-events-none'
      }`}
    >
      <div className="flex items-start gap-2 mb-1">
        <span className="mt-1 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colour }} />
        <div className="font-sans font-semibold text-sm text-on-surface leading-snug flex-1">{entryName(entry)}</div>
        {cardIsSelection && (
          <Tooltip contents content="Clear selection">
            <button
              type="button"
              onClick={onClearSelection}
              aria-label="Clear selection"
              className={`${CONTROL_FOCUS} -mt-1 -mr-2 p-1.5 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5 transition-colors cursor-pointer press-scale`}
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
        )}
      </div>
      {(secondary || position) && (
        <div className="text-xs text-on-surface-variant mb-2 md:mb-3 pl-[18px]">
          {[position?.[3], secondary].filter(Boolean).join(', ')}
          {isMap && position?.[2] === 'location' && (
            <div className="italic mt-0.5">Approximate position (placed at the center of its location)</div>
          )}
        </div>
      )}
      <dl className="grid grid-cols-[1fr_auto] max-md:grid-cols-[1fr_auto_1fr_auto] gap-x-3 gap-y-1 text-xs">
        <dt className="text-on-surface-variant">
          <span className="max-md:hidden">{metricLabel(metricMode)} count</span>
          <span className="md:hidden">
            {metricMode === 'none' ? metricLabel(metricMode) : metricShortPrefix(metricMode)} count
          </span>
        </dt>
        <dd className="font-mono text-on-surface text-right">{Number(entry.total_fractional_score ?? 0).toFixed(2)}</dd>
        {entry.paper_count !== undefined && (
          <>
            <dt className="text-on-surface-variant">Papers</dt>
            <dd className="font-mono text-on-surface text-right">{Number(entry.paper_count).toLocaleString()}</dd>
          </>
        )}
      </dl>
      <Tooltip contents content="Collaborators in view: entries in this network that share a paper with this one. Strongest link: of the pairs among them, the share whose strongest link runs through this one rather than a direct tie or another shared partner">
        <p className="mt-1.5 w-fit text-xs leading-snug text-balance text-on-surface-variant">{keyLinkLine(stats.degree, linked)}</p>
      </Tooltip>
      {strongestTies.length > 0 && (
        <div className="max-md:hidden mt-3 pt-3 border-t border-outline-variant">
          <div className="font-display text-[10px] font-bold tracking-wider uppercase text-on-surface-variant mb-1.5">Strongest ties</div>
          {strongestTies.map(t => (
            <div key={t.id} className="flex justify-between gap-2 text-xs">
              <span className="truncate text-on-surface">{t.name}</span>
              <span className="font-mono text-on-surface-variant shrink-0">{t.papers} {t.papers === 1 ? 'paper' : 'papers'}</span>
            </div>
          ))}
        </div>
      )}
      {cardIsSelection ? (
        <button
          type="button"
          onClick={() => onOpenInList(focusId)}
          className={`${CONTROL_FOCUS} mt-2.5 md:mt-3 w-full bg-primary text-on-primary font-display font-bold text-[11px] tracking-wider uppercase py-1.5 pointer-coarse:py-2.5 rounded-full cursor-pointer shadow-interactive press-scale`}
        >
          Open in list
        </button>
      ) : (
        <div className="mt-3 text-[11px] text-on-surface-variant italic">Click to select</div>
      )}
    </div>
  );
}

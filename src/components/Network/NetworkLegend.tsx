import { metricLabel } from '../../hooks/useExplorerData';
import type { MetricMode } from '../../types';
import { HelpHint, HintItem } from '../ui/HelpHint';

interface NetworkLegendProps {
  metricMode: MetricMode;
  isMap: boolean;
  hasGrey: boolean;
  locationLevel: number;
  unplacedCount: number;
  neutralColour: string;
  legend: { label: string; r: number }[];
  kbFocused: boolean;
}

export function NetworkLegend({
  metricMode,
  isMap,
  hasGrey,
  locationLevel,
  unplacedCount,
  neutralColour,
  legend,
  kbFocused,
}: NetworkLegendProps) {
  return (
    <div className="absolute bottom-4 left-4 max-w-[calc(100%-2rem)] bg-surface/90 border border-outline-variant rounded-xl shadow-popover px-3 py-2 pointer-events-none">
      <div className="flex items-center gap-2 font-display text-[11px] font-bold tracking-wider uppercase text-on-surface-variant">
        <span>Sized by {metricLabel(metricMode)} count</span>
        <HelpHint label="How to read the network" side="top" align="left" className="pointer-events-auto">
          <HintItem term="Color">Groups that collaborate most with each other{hasGrey && '; gray marks many smaller groups'}</HintItem>
          {isMap ? (
            <>
              <HintItem term="Lines">Shared papers, thicker when stronger; large collaborations count less</HintItem>
              {locationLevel > 0 && <HintItem term="Hollow ring">Placed at the center of its location, exact position unknown ({locationLevel})</HintItem>}
              {unplacedCount > 0 && <HintItem term="Not shown">{unplacedCount} with no known location</HintItem>}
              <HintItem term="Interact" last>Click to select</HintItem>
            </>
          ) : (
            <>
              <HintItem term="Lines">Shared papers, thicker when stronger and in a group's color within it; large collaborations count less</HintItem>
              <HintItem term="Interact" last>Click to select, drag to pin, double-click to release</HintItem>
            </>
          )}
        </HelpHint>
      </div>
      {legend.length > 0 && (
        <div className="flex items-end gap-3 mt-1.5 text-[11px] text-on-surface-variant" aria-label="Node size legend">
          {legend.map((l, i) => (
            <span key={i} className="flex items-center gap-1">
              <svg width={l.r * 2 + 2} height={l.r * 2 + 2} aria-hidden="true">
                <circle cx={l.r + 1} cy={l.r + 1} r={l.r} fill={neutralColour} stroke="#000000" strokeWidth={1} />
              </svg>
              <span className="font-mono">{l.label}</span>
            </span>
          ))}
        </div>
      )}
      {kbFocused && (
        <div className="text-[11px] text-on-surface-variant mt-1">
          Keyboard: arrows move between collaborators · Enter opens in list · + / − zoom · 0 fits · Esc clears
        </div>
      )}
    </div>
  );
}

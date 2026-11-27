import { useLayoutEffect, useState } from 'react';
import type { AxisItem } from './useCrosstab';

// Match the font used by the table headings or the SVG tick labels.
export function useAxisLabelMetrics(font: 'label' | 'tick' = 'label', enabled = true): (label: string) => number {
  const [measure, setMeasure] = useState(() => (label: string) => label.length * 6);
  useLayoutEffect(() => {
    if (!enabled) return;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;
    const refresh = () => {
      const styles = getComputedStyle(document.documentElement);
      context.font = font === 'tick'
        ? `10px ${styles.getPropertyValue('--font-mono').trim() || 'monospace'}`
        : `600 11px ${styles.getPropertyValue('--font-sans').trim() || 'sans-serif'}`;
      setMeasure(() => (label: string) => context.measureText(label).width);
    };
    refresh();
    document.fonts?.addEventListener('loadingdone', refresh);
    return () => document.fonts?.removeEventListener('loadingdone', refresh);
  }, [font, enabled]);
  return measure;
}

export function widestLabel(items: readonly AxisItem[], measure: (label: string) => number): number {
  return Math.ceil(items.reduce((max, item) => Math.max(max, measure(item.label)), 0));
}

export function rowLabelWidth(items: readonly AxisItem[], width: number, measure: (label: string) => number): number {
  return Math.min(widestLabel(items, measure) + 8, Math.floor(width * 0.4), 320);
}

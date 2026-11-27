import { useId, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { CONTROL_BUTTON, SELECT_HEIGHT } from '../ui/Controls';
import { FIGURE_CONTROL_LABEL } from './FigureFrame';
import type { AxisItem } from './useCrosstab';

interface Props {
  label?: string;
  available: AxisItem[];
  selected?: string[];
  onChange: (selected?: string[]) => void;
}

export function SeriesPicker({ label = 'Visible series', available, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const count = selected ? available.filter(item => selected.includes(item.id)).length : available.length;
  const summary = count === 0 ? 'None' : count === available.length ? `All (${count})` : `${count} of ${available.length}`;
  const toggle = (value: string) => {
    const current = selected ?? available.map(item => item.id);
    onChange(current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
  };
  return <>
    <span className={FIGURE_CONTROL_LABEL}>
      {label}
      <button type="button" aria-label={`${label}, ${summary}`} aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(current => !current)} className={`${CONTROL_BUTTON} ${SELECT_HEIGHT} whitespace-nowrap`}>
        {summary}
        <ChevronDown aria-hidden="true" className={`h-3 w-3 ${open ? 'rotate-180' : ''}`} />
      </button>
    </span>
    <div id={id} hidden={!open} role="group" aria-label={label} className="order-last min-w-0 basis-full rounded-xl border border-outline bg-surface p-2 text-xs shadow-popover">
      <div className="mb-2 flex flex-wrap gap-2">
        <button type="button" className={CONTROL_BUTTON} onClick={() => onChange(undefined)}>Select all</button>
        <button type="button" className={CONTROL_BUTTON} onClick={() => onChange([])}>Clear all</button>
      </div>
      <div className="grid max-h-44 grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-x-3 gap-y-1 overflow-auto">
        {available.map(item => {
          const checked = !selected || selected.includes(item.id);
          return <label key={item.id}
            className={`flex min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-on-surface [overflow-wrap:anywhere] ${checked ? 'bg-primary/10' : 'hover:bg-on-surface/5'}`}>
            <input type="checkbox" checked={checked} onChange={() => toggle(item.id)} className="peer sr-only" />
            <span aria-hidden="true" className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center border squircle-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary ${checked ? 'border-primary bg-primary text-on-primary' : 'border-outline'}`}>
              {checked && <Check className="h-2.5 w-2.5" />}
            </span>
            {item.label}
          </label>;
        })}
      </div>
    </div>
  </>;
}

import { Search, X } from 'lucide-react';
import { CONTROL_FOCUS } from '../ui/Controls';
import { Tooltip } from '../ui/Tooltip';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  clearLabel: string;
}

/** The sidebar's one search field, for finding a filter value in a long list. */
export function SearchField({ value, onChange, placeholder, label, clearLabel }: SearchFieldProps) {
  return (
    <div className="flex justify-center mb-4 w-full px-4">
      <div className="relative w-full max-w-[380px] md:max-w-[420px] lg:max-w-[368px] 2xl:max-w-[420px] mx-auto">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant pointer-events-none" aria-hidden="true" />
        <input
          type="text"
          placeholder={placeholder}
          aria-label={label}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-surface border border-outline rounded-full pl-9 pr-8 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary transition-all ease-[var(--ease-spring)] shadow-interactive focus-glow"
        />
        {value && (
          <Tooltip contents content={clearLabel}>
            <button
              type="button"
              onClick={() => onChange('')}
              aria-label={clearLabel}
              className={`${CONTROL_FOCUS} absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5 rounded-full transition-colors ease-[var(--ease-spring)] bg-transparent border-none cursor-pointer p-2 flex items-center justify-center shadow-interactive press-scale`}
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

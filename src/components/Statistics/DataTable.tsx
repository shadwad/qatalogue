import React from 'react';

export interface DataTableColumn {
  label: string;
  /** Numbers line up on the right; names read from the left. */
  numeric?: boolean;
}

interface DataTableProps {
  caption: string;
  columns: DataTableColumn[];
  rows: React.ReactNode[][];
}

/** Tabular view of a figure's values in its fixed row order. */
export const DataTable: React.FC<DataTableProps> = ({ caption, columns, rows }) => (
  <div className="w-fit max-w-full max-h-[560px] overflow-auto" data-figure-table>
    <table className="border-collapse text-xs">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((column, i) => (
            <th key={`${column.label}-${i}`} scope="col" className={`sticky top-0 z-[1] border-b border-outline bg-surface px-2 py-1.5 align-bottom font-sans text-[11px] font-semibold leading-tight text-on-surface-variant ${column.numeric ? 'text-right' : 'text-left'}`}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="hover:bg-on-surface/5">
            {row.map((value, j) => (
              <td key={j} className={`border-b border-outline-variant px-2 py-1 ${columns[j].numeric ? 'whitespace-nowrap text-right font-mono text-[11px] text-on-surface' : 'text-on-surface-variant'}`}>
                {value}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

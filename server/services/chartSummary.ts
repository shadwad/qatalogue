import { CHART_FIELDS, type ChartData, type Field, type NumericField } from '../../shared/chart';

export interface PaperCounts {
  authors: number | null;
  institutions: number | null;
  locations: number | null;
}
interface ChartInputs {
  ids: string[];
  row: Field;
  split: Field | '';
  bin: number;
  counts: (id: string) => PaperCounts;
  categories: (field: Field, id: string) => readonly string[];
}

interface Bucket {
  row: string; col: string; papers: number;
  sums: Record<NumericField, number>; bases: Record<NumericField, number>;
}
const numericFields: NumericField[] = ['authors', 'institutions', 'locations'];
const zeros = () => ({ authors: 0, institutions: 0, locations: 0 });

// Visit each matching paper once. Row and column totals count distinct papers even
// when a paper contributes to several cells. Missing measurements never enter a mean.
export function summarizeChart({ ids, row, split, bin, counts, categories }: ChartInputs): ChartData {
  const buckets = new Map<string, Map<string, Bucket>>();
  const rowTotals: Record<string, number> = Object.create(null);
  const colTotals: Record<string, number> = Object.create(null);
  const usesPlatform = row === 'platform' || split === 'platform';
  const taggedByRow: Record<string, number> | undefined = split === 'platform' ? Object.create(null) : undefined;
  let shown = 0;
  let tagged = 0;
  for (const id of ids) {
    const measurements = counts(id);
    let rows: readonly string[];
    if (CHART_FIELDS[row].kind === 'number') {
      const n = measurements[row as NumericField];
      rows = n === null ? [] : [String(1 + Math.floor((n - 1) / bin) * bin)];
    } else {
      rows = categories(row, id);
    }
    const cols = split ? categories(split, id) : [''];
    if (usesPlatform && (row === 'platform' ? rows : cols).length) tagged++;
    if (rows.length && cols.length) shown++;
    for (const col of cols) colTotals[col] = (colTotals[col] ?? 0) + 1;
    for (const r of rows) {
      if (taggedByRow && cols.length) taggedByRow[r] = (taggedByRow[r] ?? 0) + 1;
      rowTotals[r] = (rowTotals[r] ?? 0) + 1;
      let columns = buckets.get(r);
      if (!columns) { columns = new Map(); buckets.set(r, columns); }
      for (const col of cols) {
        let bucket = columns.get(col);
        if (!bucket) {
          bucket = { row: r, col, papers: 0, sums: zeros(), bases: zeros() };
          columns.set(col, bucket);
        }
        bucket.papers++;
        for (const field of numericFields) {
          const n = measurements[field];
          if (n !== null) { bucket.sums[field] += n; bucket.bases[field]++; }
        }
      }
    }
  }
  const cells = [...buckets.values()].flatMap(columns => [...columns.values()].map(bucket => {
    const mean = (f: NumericField) => bucket.bases[f] ? bucket.sums[f] / bucket.bases[f] : null;
    return { row: bucket.row, col: bucket.col, papers: bucket.papers, authors: mean('authors'), institutions: mean('institutions'), locations: mean('locations') };
  }));
  return { cells, rowTotals, colTotals, papers: ids.length, shown, taggedByRow, platformTagged: usesPlatform ? tagged : undefined };
}

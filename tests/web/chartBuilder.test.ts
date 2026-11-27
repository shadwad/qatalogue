import '../helpers/locationsFixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { summarizeChart } from '../../server/services/chartSummary';
import { ChartPlots } from '../../src/components/Statistics/ChartPlots';
import { FigureFrame } from '../../src/components/Statistics/FigureFrame';
import { HeatGrid } from '../../src/components/Statistics/HeatGrid';
import { rowLabelWidth } from '../../src/components/Statistics/useAxisLabelMetrics';
import { horizontalTicks, panelLayout } from '../../src/components/Statistics/plotLayout';
import { chartChoices, decodeFigures, encodeFigures, layoutFigures, MAX_FIGURES, newChart } from '../../src/components/Statistics/figureConfig';
import { readUrlState, toSearch } from '../../src/hooks/urlState';
import { focusAddedChart } from '../../src/components/Statistics/figureViewport';
import { assignSeriesSlots, blankChart, chartValue, configureChart, FORMS, keysOf, measures, rowFields, splitFields, type ChartSpec } from '../../shared/chart';

test('every chart form starts without bindings and supports more than one variable', () => {
  for (const form of keysOf(FORMS)) {
    const chart = newChart(form);
    assert.equal(chart.type, 'custom');
    assert.deepEqual(chart.vars, blankChart(form));
    assert.ok(rowFields(form).length > 1);
  }
  assert.deepEqual(rowFields('histogram'), ['authors', 'institutions', 'locations']);
  assert.ok(!rowFields('line').includes('venue'));
  assert.deepEqual(splitFields('stack', 'year'), ['venue', 'reach']);
  assert.ok(!splitFields('heatmap', 'topic').includes('subtopic'));
  assert.ok(!measures('stack', 'venue').includes('seriesShare'));
});

test('changing compatible marks preserves the analysis, including selected series', () => {
  const spec: ChartSpec = { ...blankChart('heatmap'), row: 'year', split: 'venue', value: 'rowShare', series: ['A'] };
  for (const form of ['line', 'bar', 'dot', 'stack'] as const) {
    assert.deepEqual(configureChart(spec, { form }), { ...spec, form });
  }
  const transposed = configureChart({ ...spec, row: 'venue', split: 'year', series: undefined }, { form: 'line' });
  assert.equal(transposed.row, 'year');
  assert.equal(transposed.split, 'venue');
  assert.equal(transposed.value, 'seriesShare');
  const histogram = configureChart(spec, { form: 'histogram' });
  assert.equal(histogram.row, '');
  assert.equal(histogram.split, 'venue');
  assert.equal(histogram.value, 'seriesShare');
});

test('saved charts round-trip, including blank charts, older links and punctuation in a series', () => {
  const chart = newChart('line');
  assert.ok(chart.type === 'custom');
  chart.wide = true;
  chart.vars = { ...chart.vars, row: 'year', split: 'venue', panels: 'independent', series: ['A.~ & B/%'] };
  const encoded = encodeFigures([chart, newChart('scatter')]);
  const url = new URLSearchParams(encoded.map(value => ['fig', value]));
  assert.deepEqual(encodeFigures(decodeFigures(new URLSearchParams(url.toString()).getAll('fig'))), encoded);
  const [adapted] = decodeFigures(['heatmap.topic.platform.share~wide']);
  assert.ok(adapted?.type === 'custom');
  assert.deepEqual([adapted.vars.row, adapted.vars.split, adapted.vars.value, adapted.wide], ['topic', 'platform', 'seriesShare', true]);
  const [bars, trend] = decodeFigures(['category.venue.papers.dot', 'trends.region.share.independent']);
  assert.deepEqual([bars.vars.form, bars.vars.row, trend.vars.form, trend.vars.value, trend.vars.panels], ['dot', 'venue', 'line', 'rowShare', 'independent']);
});

test('Charts starts with one bar chart and remembers an explicitly empty dashboard', () => {
  for (const search of ['', '?section=charts', '?section=statistics']) {
    assert.deepEqual(readUrlState(search).figures.map(figure => figure.vars), [blankChart('bar')]);
  }
  for (const search of ['?section=charts&fig=none', '?section=charts&fig=unknown', '?section=statistics&fig=none']) {
    assert.deepEqual(readUrlState(search).figures, []);
  }
  // Links name the view Charts; links from when it was Statistics still open it.
  assert.equal(readUrlState('?section=statistics').section, 'statistics');
  const state = { ...readUrlState('?section=charts'), from: 2020, to: 2026 };
  const bounds = { min: state.from, max: state.to };
  const cleared = toSearch({ ...state, figures: [] }, bounds);
  assert.equal(cleared, '?section=charts&fig=none');
  assert.deepEqual(readUrlState(cleared).figures, []);
});

test('explicit chart links restore every row', () => {
  const state = { ...readUrlState('?section=statistics'), from: 2020, to: 2026 };
  const bounds = { min: state.from, max: state.to };
  const charts = Array.from({ length: MAX_FIGURES }, () => newChart('bar'));
  const dimensions = { labels: () => [], years: 7 };
  for (let count = 1; count <= MAX_FIGURES; count++) {
    const figures = charts.slice(0, count);
    const restored = readUrlState(toSearch({ ...state, figures }, bounds)).figures;
    assert.deepEqual(encodeFigures(restored), encodeFigures(figures));
    const desktop = layoutFigures(figures, 1400, dimensions);
    assert.deepEqual(desktop.map(slot => slot.figure.id), figures.map(f => f.id));
    assert.deepEqual(desktop.map(slot => slot.width === '100%'), figures.map((_, i) => count % 2 === 1 && i === count - 1));
    assert.ok(layoutFigures(figures, 390, dimensions).every(slot => slot.width === '100%'));
  }
});

test('a matrix and a simple chart can share an asymmetric row in either order', () => {
  const [matrix, bar] = decodeFigures(['heatmap.topic.platform.papers', 'category.venue.papers.bar']);
  const dimensions = { labels: () => Array(7).fill('Category'), years: 6 };
  for (const order of [[matrix, bar], [bar, matrix]]) {
    const slots = layoutFigures(order, 1200, dimensions);
    const first = parseInt(slots[0].width);
    assert.deepEqual(slots.map(s => s.figure.id), order.map(f => f.id));
    assert.equal(slots[1].width, `calc(100% - ${first + 16}px)`);
    const matrixWidth = order[0] === matrix ? first : 1200 - first - 16;
    assert.ok(matrixWidth >= 750 && 1200 - matrixWidth - 16 >= 380);
    assert.ok(layoutFigures(order, 1100, dimensions).every(s => s.width === '100%'));
  }
  assert.ok(layoutFigures([{ ...matrix, wide: true }, bar], 1900, dimensions).every(s => s.width === '100%'));
});

test('repeated plots balance the final row and horizontal tick labels leave room for each other', () => {
  assert.deepEqual(panelLayout(5, 1000, 220, 16), { across: 3, panelWidth: 322 });
  assert.deepEqual(panelLayout(1, 294, 310, 16), { across: 1, panelWidth: 294 });
  assert.deepEqual(horizontalTicks([24, 24, 24, 24, 24], i => i * 22), [0, 2, 4]);
  assert.deepEqual(horizontalTicks([60, 60], i => i * 18), [0]);
});

test('adding a row scrolls only the results panel and leaves visible controls in place', () => {
  const focusOptions: FocusOptions[] = [];
  const panel = { scrollTop: 30, getBoundingClientRect: () => ({ top: 100, bottom: 650 }) };
  const addAt = (top: number, controlBottom: number, toolbarHeight: number) => {
    const control = { getBoundingClientRect: () => ({ bottom: controlBottom }), focus: (options: FocusOptions) => focusOptions.push(options) };
    const card = {
      getBoundingClientRect: () => ({ top }),
      querySelector: () => control,
      scrollIntoView: () => assert.fail('Scroll must stay inside the results panel'),
    };
    focusAddedChart(panel as HTMLElement, card as unknown as HTMLElement, toolbarHeight);
  };
  addAt(240, 300, 52);
  assert.equal(panel.scrollTop, 30);
  addAt(630, 690, 84);
  assert.equal(panel.scrollTop, 476);
  addAt(164, 224, 84);
  assert.equal(panel.scrollTop, 456);
  assert.deepEqual(focusOptions, Array(3).fill({ preventScroll: true }));
});

test('distinct denominators, missing values and coverage survive multi-valued groups', () => {
  const data = summarizeChart({
    ids: ['a', 'b', 'c'], row: 'topic', split: 'platform', bin: 1,
    counts: id => ({ authors: id === 'b' ? null : 2, locations: id === 'b' ? 3 : null, institutions: null }),
    categories: (field, id) => field === 'topic' ? id === 'a' ? ['X', 'Y'] : ['X'] : id === 'c' ? [] : ['P'],
  });
  assert.deepEqual([data.shown, data.platformTagged, data.papers], [2, 2, 3]);
  const cell = data.cells.find(c => c.row === 'X' && c.col === 'P');
  assert.ok(cell);
  assert.deepEqual([cell.papers, cell.authors, cell.locations, cell.institutions], [2, 2, 3, null]);
  assert.equal(chartValue(data, cell, 'X', 'P', 'rowShare'), 2 / 3);
  assert.equal(chartValue(data, cell, 'X', 'P', 'seriesShare'), 1);
  assert.equal(chartValue(data, undefined, 'X', 'missing', 'seriesShare'), null);
});

test('all seven renderers and their tables consume the common paper aggregates', () => {
  const spec: ChartSpec = { ...blankChart('bar'), row: 'authors', split: 'venue', bin: 2 };
  const data = summarizeChart({
    ids: ['a', 'b', 'c'], row: 'authors', split: 'venue', bin: 2,
    counts: id => ({ authors: id === 'a' ? 1 : id === 'b' ? 2 : 4, institutions: 1, locations: 1 }),
    categories: () => ['A'],
  });
  assert.deepEqual({ ...data.rowTotals }, { '1': 2, '3': 1 });
  const props = { data, rows: [{ id: '1', label: '1–2' }, { id: '3', label: '3–4' }], columns: [{ id: 'A', label: 'Venue A' }],
    width: 480, partialYear: null, busy: false, action: () => undefined };
  const marks = { bar: 'width:100%', dot: 'left:100%', line: '<circle', stack: 'Scale 0 to 2', heatmap: 'background-color:', histogram: '<rect', scatter: '<circle' };
  for (const form of keysOf(FORMS)) {
    const config = configureChart(spec, { form });
    const render = (table: boolean) => renderToStaticMarkup(createElement(ChartPlots, { ...props, spec: config, table }));
    assert.ok(render(false).includes(marks[form]), form);
    assert.ok(render(true).includes('Venue A'), form);
    assert.ok(render(true).includes('1–2'), form);
  }
});

test('year labels use their text width and long labels leave room for the plot', () => {
  const years = ['2021', '2022', '2023', '2024', '2025', '2026'].map(id => ({ id, label: id }));
  const topic = [{ id: 'atomic', label: 'Atomic physics & precision measurement' }];
  const textWidth = (label: string) => label.length * 6;
  for (const width of [294, 664]) {
    assert.equal(rowLabelWidth(years, width, textWidth), 32);
    assert.equal(rowLabelWidth(topic, width, textWidth), Math.min(textWidth(topic[0].label) + 8, Math.floor(width * 0.4)));
  }
  const grid = renderToStaticMarkup(createElement(HeatGrid, {
    caption: 'Papers by year', rows: topic, columns: years, width: 400, dimmed: false,
    cell: () => ({ text: '42', intensity: 1, tooltip: '42 papers' }),
  }));
  assert.ok(grid.includes('2026'));
  assert.ok(!grid.includes('vertical-rl'), 'Four-digit year headings fit horizontally even in narrow columns');
});

test('a phone-width histogram fits all 100 author bins and labels both ends', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1), label: String(i + 1) }));
  const data = summarizeChart({
    ids: rows.map(r => r.id), row: 'authors', split: '', bin: 1,
    counts: id => ({ authors: Number(id), institutions: 1, locations: 1 }), categories: () => [],
  });
  const plot = renderToStaticMarkup(createElement(ChartPlots, {
    spec: { ...blankChart('histogram'), row: 'authors' }, data, rows, columns: [{ id: '', label: '' }],
    width: 294, partialYear: null, table: false, busy: false, action: () => undefined,
  }));
  assert.match(plot, /<svg width="294"/);
  assert.equal((plot.match(/<rect /g) ?? []).length, 100);
  assert.match(plot, />100<\/text>/);
});

test('the public picker and shared dashboards contain only charts', () => {
  assert.deepEqual(chartChoices.map(({ value }) => value), ['bar', 'line', 'stack', 'heatmap', 'histogram', 'scatter']);
  const retired = ['attribution.institution.total.adjusted', 'fingerprint.subtopic.r-A123', 'journals..papers', 'change.topic.points',
    'teamsize.field.broad', 'overlap.topic.share', 'collaboration.year.share'];
  const saved = encodeFigures([newChart('scatter'), newChart('bar')]);
  assert.deepEqual(encodeFigures(decodeFigures([...retired, ...saved])), saved);
  assert.deepEqual(readUrlState('?section=statistics&fig=attribution.institution.total.adjusted').figures, []);
});

test('window actions stay in the header, separate from variable controls', () => {
  const noop = () => {};
  const frame = renderToStaticMarkup(createElement(FigureFrame, {
    title: 'Papers by year', typeControl: createElement('select', { 'aria-label': 'Chart type' }),
    controls: createElement('select', { 'aria-label': 'Group by' }), children: null,
    layout: { wide: false, onToggleWide: noop, onLater: noop }, isExpanded: false, isTable: false,
    onToggleExpand: noop, onToggleTable: noop, onClose: noop,
  }));
  const [header, body] = frame.split('</header>');
  for (const label of ['Chart type', 'Use full row for Papers by year', 'Move Papers by year later',
    'Show Papers by year as a table', 'Expand Papers by year', 'Remove Papers by year']) {
    assert.ok(header.includes(`aria-label="${label}"`), label);
  }
  assert.ok(!header.includes('Move Papers by year earlier'));
  assert.equal((header.match(/<select/g) ?? []).length, 1);
  assert.ok(!header.includes('Group by') && body.includes('Group by'));
});

test('scatter axis choices exclude a defining exact grouping variable on edit and restore', () => {
  for (const row of ['authors', 'locations', 'institutions'] as const) {
    assert.ok(!measures('scatter', '', row, 1).includes(row));
    const spec = { ...blankChart('scatter'), row, xMetric: row };
    const [loaded] = decodeFigures(encodeFigures([{ id: 1, type: 'custom', vars: spec }]));
    assert.ok(loaded.type === 'custom' && loaded.vars.xMetric !== row);
    const changed = configureChart({ ...spec, value: row, bin: 5 }, { bin: 1 });
    assert.notEqual(changed.value, row);
    assert.notEqual(changed.xMetric, row);
    assert.notEqual(changed.xMetric, changed.value);
  }
});

test('topic coverage counts a paper once even when it mentions several platforms', () => {
  const data = summarizeChart({ ids: ['tagged', 'untagged'], row: 'topic', split: 'platform', bin: 1,
    counts: () => ({ authors: 2, institutions: 1, locations: 1 }),
    categories: (field, id) => field === 'topic' ? ['QEC'] : id === 'tagged' ? ['ions', 'atoms'] : [],
  });
  assert.equal(data.taggedByRow?.QEC, 1);
  assert.equal(data.rowTotals.QEC, 2);
  assert.equal(data.cells.length, 2);
});

test('a series keeps its color when others are shown or hidden', () => {
  const slotsOf = (map: Map<string, number>) => Object.fromEntries(map);
  // First assignment: in the order shown.
  const first = assignSeriesSlots(new Map(), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(slotsOf(first), { a: 0, b: 1, c: 2, d: 3, e: 4 });
  // Hiding one leaves the rest as they were.
  const hidden = assignSeriesSlots(first, ['a', 'b', 'd', 'e']);
  assert.deepEqual(slotsOf(hidden), { a: 0, b: 1, d: 3, e: 4 });
  // A newly shown series takes the lowest free slot; the others keep theirs.
  const added = assignSeriesSlots(hidden, ['a', 'b', 'f', 'd', 'e']);
  assert.deepEqual(slotsOf(added), { a: 0, b: 1, f: 2, d: 3, e: 4 });
  // Reordering the shown series changes no color.
  assert.deepEqual(slotsOf(assignSeriesSlots(added, ['e', 'd', 'f', 'b', 'a'])), slotsOf(added));
  // With everything hidden the slots are free again, and fill from the lowest.
  const none = assignSeriesSlots(added, []);
  assert.equal(none.size, 0);
  assert.deepEqual(slotsOf(assignSeriesSlots(none, ['x', 'y'])), { x: 0, y: 1 });
  // More series than the palette get the next slots up, without disturbing the first five.
  const many = assignSeriesSlots(first, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(slotsOf(many), { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6 });
});

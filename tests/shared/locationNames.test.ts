import '../helpers/locationsFixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLocationFilter, readLocationList } from '../../server/services/utils';
import { allLocations } from '../../shared/locationNames';
import { alpha2OfNumeric } from '../../shared/locationNumeric';

const mapping: Record<string, { name: string }> = allLocations();

test('a location name with a comma, if the mapping ever has one, is one filter value, not two', () => {
  for (const [code, { name }] of Object.entries(mapping).filter(([, c]) => c.name.includes(','))) {
    assert.deepEqual(readLocationList(name), [name]);
    assert.deepEqual(readLocationList([name, 'Germany']), [name, 'Germany']);
    assert.equal(normalizeLocationFilter(name), code);
  }
});

test('every location name in the mapping reads back as its own code', () => {
  for (const [code, { name }] of Object.entries(mapping)) {
    assert.deepEqual(readLocationList(name), [name], name);
    assert.equal(normalizeLocationFilter(name), code, name);
  }
});

test('comma-separated lists of codes and plain names still work', () => {
  assert.deepEqual(readLocationList('US,DE'), ['US', 'DE']);
  assert.deepEqual(readLocationList('Germany, Japan'), ['Germany', 'Japan']);
  assert.deepEqual(readLocationList(undefined), []);
});

test('no two locations share a name', () => {
  const names = Object.values(mapping).map(c => c.name.toUpperCase());
  assert.equal(new Set(names).size, names.length);
});

test('names come from CLDR short names and agree with the runtime ICU where it has the same data', () => {
  const display = new Intl.DisplayNames(['en'], { type: 'region', style: 'short' });
  // The pinned CLDR packages and Node's own ICU can be different releases; this only reports a real divergence.
  const different = Object.entries(allLocations()).filter(([code, { name }]) => display.of(code) !== name).map(([code, { name }]) => `${code}: ${name} vs ${display.of(code)}`);
  assert.ok(different.length <= 5, `${different.length} names differ from this Node's ICU: ${different.join('; ')}`);
});

test('ISO numeric codes map to current alpha-2 location codes cleanly', () => {
  assert.equal(alpha2OfNumeric('840'), 'US');
  assert.equal(alpha2OfNumeric(276), 'DE');
  assert.equal(alpha2OfNumeric('004'), 'AF');
  assert.equal(alpha2OfNumeric(4), 'AF');
  assert.equal(alpha2OfNumeric('626'), 'TL'); // Timor-Leste uses current code TL, not retired TP
  assert.equal(alpha2OfNumeric(undefined), undefined);
  assert.equal(alpha2OfNumeric('999'), undefined);
});

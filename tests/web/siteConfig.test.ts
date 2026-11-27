import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Mail, ShieldCheck } from 'lucide-react';
import { PROJECT, suggestedCredit } from '../../src/config/projectCredit';
import { parseSiteConfig } from '../../src/config/siteConfig';
import type { SiteModalEntry } from '../../src/config/siteExtras';
import { aoeTimestamp, SiteCredit, SyncStatus } from '../../src/components/Explorer/SiteFooter';

test('empty config omits operator, contact, and issues URL', () => {
  const site = parseSiteConfig(undefined);
  assert.equal(site.author, undefined);
  assert.equal(site.copyrightYear, undefined);
  assert.equal(site.contactEmail, undefined);
  assert.equal(site.repositoryUrl, undefined);
  assert.equal(site.sourceUrl, PROJECT.repositoryUrl || undefined);
  assert.equal(site.issuesUrl, undefined);
});

test('parses complete site configuration', () => {
  const site = parseSiteConfig({
    author: { name: ' A. Person ', url: 'https://orcid.org/0000-0000-0000-0000' },
    copyrightYear: 2026,
    contactEmail: 'contact@example.org',
    repositoryUrl: 'https://github.com/example/qatalogue/',
  });
  assert.deepEqual(site.author, { name: 'A. Person', url: 'https://orcid.org/0000-0000-0000-0000' });
  assert.equal(site.copyrightYear, 2026);
  assert.equal(site.contactEmail, 'contact@example.org');
  assert.equal(site.sourceUrl, 'https://github.com/example/qatalogue/');
  assert.equal(site.issuesUrl, 'https://github.com/example/qatalogue/issues/new');
});

test('rejects invalid URLs and email addresses', () => {
  const site = parseSiteConfig({
    author: { name: 'A', url: 'javascript:alert(1)' },
    contactEmail: 'not an address',
    repositoryUrl: 'ftp://example.org',
  });
  assert.equal(site.author?.url, undefined);
  assert.equal(site.contactEmail, undefined);
  assert.equal(site.repositoryUrl, undefined);
});

test('ignores author without a name', () => {
  const site = parseSiteConfig({ author: { url: 'https://orcid.org/x' } });
  assert.equal(site.author, undefined);
});

test('suggestedCredit always names the project creator', () => {
  assert.match(suggestedCredit(), new RegExp(`by ${PROJECT.creator}`));
  const site = parseSiteConfig({ author: { name: 'Someone Else' } });
  assert.equal(site.author?.name, 'Someone Else');
  assert.match(suggestedCredit(), new RegExp(`by ${PROJECT.creator}`));
});

test('sourceUrl prefers configured repositoryUrl over project default', () => {
  const own = parseSiteConfig({ repositoryUrl: 'https://github.com/example/fork' });
  assert.equal(own.sourceUrl, 'https://github.com/example/fork');
  const none = parseSiteConfig({});
  assert.equal(none.sourceUrl, PROJECT.repositoryUrl || undefined);
  assert.equal(none.issuesUrl, undefined);
});

test('SiteCredit renders License and GitHub links without operator metadata', () => {
  const html = renderToStaticMarkup(createElement(SiteCredit, { config: parseSiteConfig(undefined), modals: [] }));
  assert.match(html, />License</);
  if (PROJECT.repositoryUrl) assert.match(html, />GitHub</);
  else assert.ok(!html.includes('GitHub'));
  assert.ok(!html.includes(PROJECT.creator));
  assert.ok(!html.includes('Powered by'));
  for (const absent of ['Contact', 'Privacy', 'Legal', '©']) {
    assert.ok(!html.includes(absent), `${absent} should not appear`);
  }
});

test('SiteCredit renders single copyright line when author matches creator', () => {
  const html = renderToStaticMarkup(
    createElement(SiteCredit, { config: parseSiteConfig({ author: { name: PROJECT.creator }, copyrightYear: 2027 }), modals: [] }),
  );
  assert.match(html, new RegExp(`© 2027 ${PROJECT.creator}`));
  assert.ok(!html.includes('Powered by'));
});

test('SiteCredit renders configured operator copyright line', () => {
  const html = renderToStaticMarkup(
    createElement(SiteCredit, { config: parseSiteConfig({ author: { name: 'Someone Else' }, copyrightYear: 2027 }), modals: [] }),
  );
  assert.match(html, /© 2027 Someone Else/);
  assert.ok(!html.includes(PROJECT.creator));
  assert.ok(!html.includes('Powered by'));
});

test('SiteCredit renders mailto Contact link when no custom contact modal exists', () => {
  const html = renderToStaticMarkup(
    createElement(SiteCredit, { config: parseSiteConfig({ contactEmail: 'contact@example.org' }), modals: [] }),
  );
  assert.match(html, /href="mailto:contact@example\.org\?subject=Qatalogue"/);
  assert.match(html, />Contact</);
});

test('SiteCredit slots custom modals and suppresses mailto fallback', () => {
  const Dummy = () => null;
  const modals: SiteModalEntry[] = [
    { id: 'contact', label: 'Contact', icon: Mail, slot: 'before-license', Component: Dummy },
    { id: 'privacy', label: 'Privacy', icon: ShieldCheck, slot: 'after-license', Component: Dummy },
  ];
  const html = renderToStaticMarkup(
    createElement(SiteCredit, { config: parseSiteConfig({ contactEmail: 'contact@example.org' }), modals }),
  );
  assert.ok(!html.includes('mailto:contact@example.org'), 'custom contact modal should suppress mailto fallback');
  assert.ok(html.indexOf('>Contact</button>') < html.indexOf('>License</button>'));
  assert.ok(html.indexOf('>License</button>') < html.indexOf('>Privacy</button>'));
});

test('aoeTimestamp shifts UTC-12 and SyncStatus falls back cleanly on malformed dates', () => {
  assert.equal(aoeTimestamp('2026-06-15T14:30:00Z'), '2026-06-15 02:30');
  assert.equal(aoeTimestamp('not-a-date'), '');
  assert.match(renderToStaticMarkup(createElement(SyncStatus, { generatedAt: '2026-06-15T14:30:00Z' })), /2026-06-15 02:30/);
  assert.match(renderToStaticMarkup(createElement(SyncStatus, { generatedAt: 'invalid' })), /Awaiting Sync/);
  assert.match(renderToStaticMarkup(createElement(SyncStatus, { generatedAt: null })), /Awaiting Sync/);
});

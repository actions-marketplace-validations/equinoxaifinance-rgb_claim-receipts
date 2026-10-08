import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupPackage, nearMiss, levenshtein } from '../src/registry.mjs';

const respond = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const NOW = Date.parse('2026-10-08T00:00:00Z');

test('levenshtein and near-miss spelling', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(nearMiss('npm', 'expres'), 'express');
  assert.equal(nearMiss('pypi', 'reqeusts'), 'requests');
  assert.equal(nearMiss('npm', 'express'), null);
  assert.equal(nearMiss('npm', 'totally-different-name'), null);
});

test('npm: missing package', async () => {
  const r = await lookupPackage({ ecosystem: 'npm', name: 'react-codeshift' }, { fetchImpl: respond(404), now: NOW });
  assert.equal(r.exists, false);
});

test('npm: existing package with age; scoped names are encoded', async () => {
  let asked;
  const fetchImpl = async (url) => { if (!url.includes('api.npmjs.org')) asked = url; return respond(200, { time: { created: '2026-10-01T00:00:00Z' } })(); };
  const r = await lookupPackage({ ecosystem: 'npm', name: '@acme/ui' }, { fetchImpl, now: NOW });
  assert.equal(asked, 'https://registry.npmjs.org/@acme%2Fui');
  assert.equal(r.exists, true);
  assert.equal(r.ageDays, 7);
});

test('pypi: earliest upload across releases', async () => {
  const body = { releases: { '0.2': [{ upload_time_iso_8601: '2024-05-01T00:00:00Z' }], '0.1': [{ upload_time_iso_8601: '2023-01-01T00:00:00Z' }], '0.0': [] } };
  const r = await lookupPackage({ ecosystem: 'pypi', name: 'httpx' }, { fetchImpl: respond(200, body), now: NOW });
  assert.equal(r.createdAt, '2023-01-01T00:00:00Z');
  assert.ok(r.ageDays > 1000);
});

test('registry errors become "could not check", never "missing"', async () => {
  const r1 = await lookupPackage({ ecosystem: 'npm', name: 'x' }, { fetchImpl: respond(503), now: NOW });
  assert.equal(r1.exists, null);
  assert.match(r1.error, /503/);
  const r2 = await lookupPackage({ ecosystem: 'npm', name: 'x' }, { fetchImpl: async () => { throw new Error('offline'); }, now: NOW });
  assert.equal(r2.exists, null);
  assert.match(r2.error, /offline/);
});

test('npm: placeholder packages and weekly downloads', async () => {
  const fetchImpl = async (url) => url.includes('api.npmjs.org')
    ? respond(200, { downloads: 4 })()
    : respond(200, { description: '🚫 Placeholder to prevent dependency confusion.', versions: { '1.0.0': {} }, time: { created: '2026-01-14T00:00:00Z' } })();
  const r = await lookupPackage({ ecosystem: 'npm', name: 'react-codeshift' }, { fetchImpl, now: NOW });
  assert.equal(r.placeholder, true);
  assert.equal(r.weeklyDownloads, 4);
  const sec = await lookupPackage({ ecosystem: 'npm', name: 'x' }, { fetchImpl: respond(200, { versions: { '0.0.1-security': {} } }), now: NOW });
  assert.equal(sec.placeholder, true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupFirestoreRules } from '../scripts/backup-firestore-rules.mjs';

test('exports active release, source and checksum using read-only requests; protects earlier backups', async () => {
  const out = await mkdtemp(join(tmpdir(), 'nexora-rules-backup-'));
  const source = "rules_version = '2'; service cloud.firestore { match /{doc=**} { allow read, write: if false; } }";
  const calls = [];
  const options = {
    project: 'example-project', token: 'test-access-token', out, now: new Date('2026-11-14T00:00:00Z'),
    fetchImpl: async (url, opts) => {
      calls.push([url, opts]);
      return { ok: true, json: async () => url.endsWith('cloud.firestore')
        ? { name: 'projects/example-project/releases/cloud.firestore', rulesetName: 'projects/example-project/rulesets/current' }
        : { source: { files: [{ name: 'firestore.rules', content: source }] } } };
    }
  };
  try {
    const backup = await backupFirestoreRules(options);
    assert.equal(await readFile(join(backup.directory, 'firestore.rules'), 'utf8'), source);
    const manifest = JSON.parse(await readFile(join(backup.directory, 'manifest.json'), 'utf8'));
    assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
    assert.equal(manifest.rulesetName, 'projects/example-project/rulesets/current');
    assert.equal(JSON.stringify(manifest).includes(options.token), false);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(([url, opts]) => url.startsWith('https://firebaserules.googleapis.com/v1/projects/example-project/') && !opts.method && opts.redirect === 'error'));
    await assert.rejects(backupFirestoreRules(options), { code: 'EEXIST' });
    assert.equal(await readFile(join(backup.directory, 'firestore.rules'), 'utf8'), source);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('refuses missing credentials, cross-project rulesets, HTTP failures and incomplete source before writing', async () => {
  const out = await mkdtemp(join(tmpdir(), 'nexora-rules-backup-'));
  const base = { project: 'example-project', token: 'test-access-token', out };
  try {
    await assert.rejects(backupFirestoreRules({ ...base, project: undefined }), /explicit Firebase project/);
    await assert.rejects(backupFirestoreRules({ ...base, token: '' }), /FIREBASE_ACCESS_TOKEN/);
    await assert.rejects(backupFirestoreRules({ ...base, fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
    await assert.rejects(backupFirestoreRules({ ...base, fetchImpl: async () => ({ ok: true, json: async () => ({ rulesetName: 'projects/other-project/rulesets/current' }) }) }), /unexpected ruleset/);
    let i = 0;
    await assert.rejects(backupFirestoreRules({ ...base, fetchImpl: async () => ({ ok: true, json: async () => ++i === 1 ? { rulesetName: 'projects/example-project/rulesets/current' } : {} }) }), /source file/);
    assert.deepEqual(await readdir(out), []);
  } finally { await rm(out, { recursive: true, force: true }); }
});

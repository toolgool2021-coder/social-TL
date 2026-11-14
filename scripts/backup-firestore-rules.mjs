import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = content => createHash('sha256').update(content).digest('hex');

// Read-only Firebase Rules API. No release or ruleset is modified by this tool.
export async function backupFirestoreRules({ project, token, out = 'deployment-backups', fetchImpl = fetch, now = new Date() }) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project || '')) {
    throw Error('Specify an explicit Firebase project ID with --project.');
  }
  if (!token || /[\r\n]/.test(token)) throw Error('Set FIREBASE_ACCESS_TOKEN locally to a valid OAuth access token.');
  const api = 'https://firebaserules.googleapis.com/v1/';
  async function read(path) {
    const response = await fetchImpl(api + path, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error'
    });
    if (!response.ok) throw Error(`Firebase Rules export failed (HTTP ${response.status}). No deployment was performed.`);
    return response.json();
  }
  const release = await read(`projects/${project}/releases/cloud.firestore`);
  if (typeof release.rulesetName !== 'string' ||
      !release.rulesetName.startsWith(`projects/${project}/rulesets/`) ||
      !/^projects\/[^/]+\/rulesets\/[^/]+$/.test(release.rulesetName)) {
    throw Error('Firebase returned an unexpected ruleset reference.');
  }
  const ruleset = await read(release.rulesetName);
  const files = ruleset.source?.files;
  if (!Array.isArray(files) || files.length !== 1 || typeof files[0].content !== 'string' ||
      !files[0].content.includes('service cloud.firestore')) {
    throw Error('Expected one Firestore rules source file. Inspect the active release manually.');
  }
  // Fetch and validate everything before writing; never label repository rules as a live backup.
  const content = files[0].content;
  const exportedAt = now.toISOString();
  const manifest = {
    project, exportedAt, releaseName: release.name,
    rulesetName: release.rulesetName, sha256: sha256(content), sourceFile: files[0].name
  };
  const parent = resolve(out);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = join(parent, `${project}-${exportedAt.replace(/[:.]/g, '-')}`);
  // Exclusive directory/file creation protects earlier backups from being overwritten.
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, 'firestore.rules'), content, { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'release.json'), JSON.stringify(release, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'ruleset.json'), JSON.stringify(ruleset, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { directory, ...manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length % 2 || args.some((v, i) => i % 2 === 0 && !['--project', '--out'].includes(v))) {
      throw Error('Usage: node scripts/backup-firestore-rules.mjs --project PROJECT_ID [--out DIRECTORY]');
    }
    const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2].slice(2), args[i * 2 + 1]]));
    const result = await backupFirestoreRules({ ...options, token: process.env.FIREBASE_ACCESS_TOKEN });
    console.log(`Active Firestore rules saved: ${result.directory}\nSHA-256: ${result.sha256}`);
  } catch (error) {
    // Do not log HTTP request objects, headers, or access tokens.
    console.error(error.message);
    process.exitCode = 1;
  }
}

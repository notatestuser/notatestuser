import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'scripts/update-profile-graphics.mjs');
const fixture = path.join(repoRoot, 'test/fixtures/profile-stats.json');

test('renders slim profile graphics from a fixture', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'profile-graphics-'));

  execFileSync(process.execPath, [
    script,
    '--fixture',
    fixture,
    '--out-dir',
    outDir,
    '--asset-suffix',
    'test'
  ], { encoding: 'utf8' });

  const readme = readFileSync(path.join(outDir, 'README.md'), 'utf8');
  assert.match(readme, /github-activity-light-test\.svg/);
  assert.match(readme, /github-activity-dark-test\.svg/);

  const lightPath = path.join(outDir, 'assets/github-activity-light-test.svg');
  const darkPath = path.join(outDir, 'assets/github-activity-dark-test.svg');
  assert.equal(existsSync(lightPath), true);
  assert.equal(existsSync(darkPath), true);

  const light = readFileSync(lightPath, 'utf8');
  assert.match(light, /width="980" height="225"/);
  assert.match(light, /Public \/ private/);
  assert.match(light, /Language mix/);
  assert.doesNotMatch(light, /visible commits|opened PRs|reviews|public repos|private repos/);
  assert.doesNotMatch(light, /Private values are GitHub restricted contribution totals/);
  assert.doesNotMatch(light, /Readable committed repo byte totals/);
  assert.doesNotMatch(light, /Activity at a glance|GITHUB CONTRIBUTION GRAPH/);
});

test('uses the next counter when no asset suffix is provided', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'profile-graphics-'));
  const assetsDir = path.join(outDir, 'assets');
  mkdirSync(assetsDir);
  writeFileSync(path.join(assetsDir, 'github-activity-light-v0007.svg'), '<svg/>');
  writeFileSync(path.join(assetsDir, 'github-activity-dark-v0007.svg'), '<svg/>');

  execFileSync(process.execPath, [
    script,
    '--fixture',
    fixture,
    '--out-dir',
    outDir
  ], { encoding: 'utf8' });

  const readme = readFileSync(path.join(outDir, 'README.md'), 'utf8');
  assert.match(readme, /github-activity-light-v0008\.svg/);
  assert.match(readme, /github-activity-dark-v0008\.svg/);
  assert.equal(existsSync(path.join(assetsDir, 'github-activity-light-v0007.svg')), false);
});

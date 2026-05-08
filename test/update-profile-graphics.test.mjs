import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'scripts/update-profile-graphics.mjs');
const fixture = path.join(repoRoot, 'test/fixtures/profile-stats.json');
const contributionFixture = path.join(repoRoot, 'test/fixtures/contribution-buckets.json');
const changedFileFixture = path.join(repoRoot, 'test/fixtures/changed-file-language-stats.json');

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

test('keeps existing asset paths when rendered graphics are unchanged', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'profile-graphics-'));

  execFileSync(process.execPath, [
    script,
    '--fixture',
    fixture,
    '--out-dir',
    outDir,
    '--asset-suffix',
    'stable'
  ], { encoding: 'utf8' });

  execFileSync(process.execPath, [
    script,
    '--fixture',
    fixture,
    '--out-dir',
    outDir
  ], { encoding: 'utf8' });

  const readme = readFileSync(path.join(outDir, 'README.md'), 'utf8');
  assert.match(readme, /github-activity-light-stable\.svg/);
  assert.match(readme, /github-activity-dark-stable\.svg/);
  assert.equal(existsSync(path.join(outDir, 'assets/github-activity-light-v0001.svg')), false);
  assert.equal(existsSync(path.join(outDir, 'assets/github-activity-dark-v0001.svg')), false);
});

test('keeps visible private repository contributions private', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'profile-graphics-'));

  execFileSync(process.execPath, [
    script,
    '--fixture',
    contributionFixture,
    '--out-dir',
    outDir,
    '--asset-suffix',
    'visibility'
  ], { encoding: 'utf8' });

  const light = readFileSync(path.join(outDir, 'assets/github-activity-light-visibility.svg'), 'utf8');
  assert.match(light, /Private/);
  assert.match(light, /12 \/ 70\.6%/);
  assert.match(light, /Public/);
  assert.match(light, /5 \/ 29\.4%/);
  assert.match(light, /<path d="M 162 211 L [^"]+ A 72 72 0 1 1 [^"]+" fill="#7c3aed"\/>/);
  assert.doesNotMatch(light, /Private<\/text>\s*<text[^>]*>5 \/ 29\.4%<\/text>/);
  assert.doesNotMatch(light, /Public<\/text>\s*<text[^>]*>12 \/ 70\.6%<\/text>/);
});

test('renders language mix from changed source files', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'profile-graphics-'));

  execFileSync(process.execPath, [
    script,
    '--fixture',
    changedFileFixture,
    '--out-dir',
    outDir,
    '--asset-suffix',
    'changes'
  ], { encoding: 'utf8' });

  const light = readFileSync(path.join(outDir, 'assets/github-activity-light-changes.svg'), 'utf8');
  assert.match(light, /<text x="632" y="207" text-anchor="middle" class="centerBig" fill="#24292f">3<\/text>/);
  assert.match(light, /Rust<\/text>\s*<text[^>]*>60\.0%<\/text>/);
  assert.match(light, /TypeScript<\/text>\s*<text[^>]*>20\.0%<\/text>/);
  assert.match(light, /JavaScript<\/text>\s*<text[^>]*>20\.0%<\/text>/);
  assert.doesNotMatch(light, /Go<\/text>/);
  assert.doesNotMatch(light, /Markdown<\/text>|JSON<\/text>/);
});

test('waits and retries GitHub REST rate limits', async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'profile-graphics-'));
  let privateRepoRequests = 0;
  const server = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/graphql') {
      const body = await readRequestBody(request);
      response.setHeader('content-type', 'application/json');
      if (body.includes('contributionYears')) {
        response.end(JSON.stringify({
          data: { user: { contributionsCollection: { contributionYears: [2026] } } }
        }));
      } else {
        response.end(JSON.stringify({
          data: {
            user: {
              y2026: {
                contributionCalendar: { totalContributions: 0 },
                restrictedContributionsCount: 0,
                commitContributionsByRepository: [],
                issueContributionsByRepository: [],
                pullRequestContributionsByRepository: [],
                pullRequestReviewContributionsByRepository: [],
                repositoryContributions: { nodes: [] }
              }
            }
          }
        }));
      }
      return;
    }

    if (request.method === 'GET' && request.url.startsWith('/user/repos')) {
      privateRepoRequests += 1;
      response.setHeader('content-type', 'application/json');
      if (privateRepoRequests === 1) {
        response.statusCode = 403;
        response.setHeader('retry-after', '0');
        response.setHeader('x-ratelimit-remaining', '0');
        response.setHeader('x-ratelimit-reset', String(Math.floor(Date.now() / 1000)));
        response.end(JSON.stringify({ message: 'API rate limit exceeded for test' }));
      } else {
        response.end(JSON.stringify([]));
      }
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ message: 'not found' }));
  });

  await listen(server);
  try {
    const { port } = server.address();
    const result = await runProcess(process.execPath, [
      script,
      '--login',
      'octocat',
      '--out-dir',
      outDir,
      '--asset-suffix',
      'retry'
    ], {
      env: {
        ...process.env,
        GH_TOKEN: 'test-token',
        GITHUB_API_ROOT: `http://127.0.0.1:${port}`
      }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(privateRepoRequests, 2);
    assert.match(result.stderr, /rate limited: API rate limit exceeded for test/);
    assert.match(result.stderr, /retry-after=0 remaining=0 reset=/);
    assert.equal(existsSync(path.join(outDir, 'assets/github-activity-light-retry.svg')), true);
  } finally {
    await close(server);
  }
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function runProcess(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

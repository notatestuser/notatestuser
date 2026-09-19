import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'scripts/update-profile-graphics.mjs');
const fixture = path.join(repoRoot, 'test/fixtures/profile-stats.json');
const contributionFixture = path.join(repoRoot, 'test/fixtures/contribution-buckets.json');
const changedFileFixture = path.join(repoRoot, 'test/fixtures/changed-file-language-stats.json');
const extendedFixture = path.join(repoRoot, 'test/fixtures/extended-language-stats.json');
const { rateLimitWaitMs } = await import(pathToFileURL(script));

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

test('splits commit contributions by visibility and ignores other activity', () => {
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
  assert.match(light, /9 \/ 75\.0%/);
  assert.match(light, /Public/);
  assert.match(light, /3 \/ 25\.0%/);
  assert.match(light, /centerBig[^>]*>12<\/text>/);
  assert.match(light, /<path d="M 162 211 L [^"]+ A 72 72 0 1 1 [^"]+" fill="#7c3aed"\/>/);
  assert.doesNotMatch(light, /Private<\/text>\s*<text[^>]*>3 \/ 25\.0%<\/text>/);
  assert.doesNotMatch(light, /Public<\/text>\s*<text[^>]*>9 \/ 75\.0%<\/text>/);
});

test('does not count created or forked repositories as commits', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'profile-graphics-'));
  const nonCommitFixture = path.join(repoRoot, 'test/fixtures/non-commit-contributions.json');

  execFileSync(process.execPath, [
    script,
    '--fixture',
    nonCommitFixture,
    '--out-dir',
    outDir,
    '--asset-suffix',
    'non-commit'
  ], { encoding: 'utf8' });

  const light = readFileSync(path.join(outDir, 'assets/github-activity-light-non-commit.svg'), 'utf8');
  assert.match(light, /centerBig[^>]*>0<\/text>/);
  assert.match(light, /Private<\/text>\s*<text[^>]*>0 \/ 0\.0%<\/text>/);
  assert.match(light, /Public<\/text>\s*<text[^>]*>0 \/ 0\.0%<\/text>/);
  assert.doesNotMatch(light, /<path d="M 162 211 /);
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

test('recognizes additional source languages and still ignores docs', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'profile-graphics-'));

  execFileSync(process.execPath, [
    script,
    '--fixture',
    extendedFixture,
    '--out-dir',
    outDir,
    '--asset-suffix',
    'extended'
  ], { encoding: 'utf8' });

  const light = readFileSync(path.join(outDir, 'assets/github-activity-light-extended.svg'), 'utf8');
  assert.match(light, /centerBig[^>]*>7<\/text>/);
  for (const language of ['Lua', 'SQL', 'HCL', 'Haskell', 'PowerShell', 'GraphQL', 'Rust']) {
    assert.match(light, new RegExp(`${language}</text>`));
  }
  assert.doesNotMatch(light, /MDX/);
});

test('excludes forked private repositories from commit languages', async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'profile-graphics-'));
  let forkedRepoRequests = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'POST' && url.pathname === '/graphql') {
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
                restrictedContributionsCount: 0,
                commitContributionsByRepository: []
              }
            }
          }
        }));
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/user/repos') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([
        { full_name: 'octocat/forked-repo', fork: true },
        { full_name: 'octocat/private-repo', fork: false }
      ]));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/repos/octocat/forked-repo/commits') {
      forkedRepoRequests += 1;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{ sha: 'forked-sha' }]));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/repos/octocat/private-repo/commits') {
      const page = url.searchParams.get('page') || '1';
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(page === '1' ? [{ sha: 'private-sha' }] : []));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/repos/octocat/private-repo/commits/private-sha') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        files: [{ filename: 'src/main.rs', additions: 5, deletions: 5, changes: 10 }]
      }));
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
      'forks'
    ], {
      env: {
        ...process.env,
        GH_TOKEN: 'test-token',
        GITHUB_API_ROOT: `http://127.0.0.1:${port}`
      }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(forkedRepoRequests, 0);
    assert.match(result.stdout, /Collecting changed-file languages from 1 readable commit repositories\./);
    const light = readFileSync(path.join(outDir, 'assets/github-activity-light-forks.svg'), 'utf8');
    assert.match(light, /Rust<\/text>\s*<text[^>]*>100\.0%<\/text>/);
  } finally {
    await close(server);
  }
});

test('skips merge commits and ignores pre-fix language caches', async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'profile-graphics-'));
  const cachePath = path.join(outDir, 'language-cache.json');
  const staleKey = createHash('sha256').update('octocat/merge-repo@merge-sha').digest('hex');
  writeFileSync(cachePath, JSON.stringify({
    version: 2,
    commits: {
      [staleKey]: { languages: [{ name: 'Go', bytes: 999 }] }
    }
  }));

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'POST' && url.pathname === '/graphql') {
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
                restrictedContributionsCount: 0,
                commitContributionsByRepository: []
              }
            }
          }
        }));
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/user/repos') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{ full_name: 'octocat/merge-repo', fork: false }]));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/repos/octocat/merge-repo/commits') {
      const page = url.searchParams.get('page') || '1';
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(page === '1' ? [{ sha: 'merge-sha' }, { sha: 'plain-sha' }] : []));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/repos/octocat/merge-repo/commits/merge-sha') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        parents: [{ sha: 'p1' }, { sha: 'p2' }],
        files: [{ filename: 'src/merged.go', additions: 60, deletions: 40, changes: 100 }]
      }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/repos/octocat/merge-repo/commits/plain-sha') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        parents: [{ sha: 'p1' }],
        files: [
          { filename: 'src/main.rs', additions: 6, deletions: 4, changes: 10 },
          { filename: 'src/unknown.customlang', additions: 3, deletions: 2, changes: 5 }
        ]
      }));
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
      'merge',
      '--language-cache',
      cachePath
    ], {
      env: {
        ...process.env,
        GH_TOKEN: 'test-token',
        GITHUB_API_ROOT: `http://127.0.0.1:${port}`
      }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Skipped 1 merge commit carrying 100 changed lines/);
    assert.match(result.stdout, /Excluded 5 changed lines from unmapped extensions \(33\.3% of 15 inspected\); top: \.customlang \(1\)\./);
    const light = readFileSync(path.join(outDir, 'assets/github-activity-light-merge.svg'), 'utf8');
    assert.doesNotMatch(light, /Go<\/text>/);
    assert.match(light, /Rust<\/text>\s*<text[^>]*>100\.0%<\/text>/);
  } finally {
    await close(server);
  }
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
                restrictedContributionsCount: 0,
                commitContributionsByRepository: []
              }
            }
          }
        }));
      }
      return;
    }

    if (request.method === 'GET' && request.url.startsWith('/user/repos')) {
      privateRepoRequests += 1;
      if (privateRepoRequests === 1) {
        response.statusCode = 403;
        response.setHeader('content-type', 'text/html');
        response.setHeader('retry-after', '0');
        response.setHeader('x-ratelimit-remaining', '0');
        response.setHeader('x-ratelimit-reset', String(Math.floor(Date.now() / 1000)));
        response.end('<html><h1>API rate limit exceeded for test</h1></html>');
      } else {
        response.setHeader('content-type', 'application/json');
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
    assert.match(result.stderr, /rate limited: non-JSON response \(403 Forbidden\): <html>/);
    assert.match(result.stderr, /retry-after=0 remaining=0 reset=/);
    assert.equal(existsSync(path.join(outDir, 'assets/github-activity-light-retry.svg')), true);
  } finally {
    await close(server);
  }
});

test('calculates primary rate-limit waits from GitHub response time', () => {
  const response = new Response('{}', {
    status: 403,
    headers: {
      date: 'Fri, 08 May 2026 21:11:04 GMT',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(Date.parse('2026-05-08T21:55:25Z') / 1000)
    }
  });

  assert.equal(rateLimitWaitMs({
    response,
    message: 'API rate limit exceeded for test'
  }), 2666000);
});

test('recognizes rate-limit headers when the response body is not JSON', () => {
  const response = new Response('<html><h1>rate limited</h1></html>', {
    status: 403,
    headers: {
      'retry-after': '12'
    }
  });

  assert.equal(rateLimitWaitMs({
    response,
    message: 'non-JSON response (403 Forbidden): <html><h1>rate limited</h1></html>'
  }), 12000);
});

test('uses a real backoff when rate-limit reset is stale', () => {
  const response = new Response('{}', {
    status: 403,
    headers: {
      date: 'Fri, 08 May 2026 21:55:26 GMT',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(Date.parse('2026-05-08T21:55:25Z') / 1000)
    }
  });

  assert.equal(rateLimitWaitMs({
    response,
    message: 'API rate limit exceeded for test',
    attempt: 0
  }), 60000);

  assert.equal(rateLimitWaitMs({
    response,
    message: 'API rate limit exceeded for test',
    attempt: 2
  }), 240000);
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

#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const USER_AGENT = 'profile-activity-graphics';
const API_ROOT = 'https://api.github.com';
const GENERATED_ASSET_RE = /^github-activity-(light|dark)-.+\.svg$/;
const COUNTER_ASSET_RE = /^github-activity-(?:light|dark)-v(\d+)\.svg$/;
const REQUEST_TIMEOUT_MS = 30000;
const REPOSITORY_CONTRIBUTION_GROUPS = [
  'commitContributionsByRepository',
  'issueContributionsByRepository',
  'pullRequestContributionsByRepository',
  'pullRequestReviewContributionsByRepository'
];
const COMMIT_LANGUAGE_CACHE_VERSION = 2;
const DEFAULT_LANGUAGE_CACHE = '.cache/profile-activity-language-cache.json';

const LANGUAGE_BY_EXTENSION = new Map([
  ['.c', 'C'],
  ['.cc', 'C++'],
  ['.cpp', 'C++'],
  ['.cxx', 'C++'],
  ['.h', 'C'],
  ['.hpp', 'C++'],
  ['.hh', 'C++'],
  ['.cs', 'C#'],
  ['.css', 'CSS'],
  ['.dart', 'Dart'],
  ['.ex', 'Elixir'],
  ['.exs', 'Elixir'],
  ['.go', 'Go'],
  ['.html', 'HTML'],
  ['.htm', 'HTML'],
  ['.java', 'Java'],
  ['.js', 'JavaScript'],
  ['.jsx', 'JavaScript'],
  ['.mjs', 'JavaScript'],
  ['.cjs', 'JavaScript'],
  ['.kt', 'Kotlin'],
  ['.kts', 'Kotlin'],
  ['.m', 'Objective-C'],
  ['.mm', 'Objective-C++'],
  ['.php', 'PHP'],
  ['.py', 'Python'],
  ['.pyi', 'Python'],
  ['.rb', 'Ruby'],
  ['.rs', 'Rust'],
  ['.sass', 'CSS'],
  ['.scala', 'Scala'],
  ['.scss', 'CSS'],
  ['.sh', 'Shell'],
  ['.bash', 'Shell'],
  ['.fish', 'Shell'],
  ['.zsh', 'Shell'],
  ['.sol', 'Solidity'],
  ['.svelte', 'Svelte'],
  ['.swift', 'Swift'],
  ['.ts', 'TypeScript'],
  ['.tsx', 'TypeScript'],
  ['.mts', 'TypeScript'],
  ['.cts', 'TypeScript'],
  ['.vue', 'Vue']
]);

const LANGUAGE_BY_BASENAME = new Map([
  ['cmakelists.txt', 'CMake'],
  ['dockerfile', 'Dockerfile'],
  ['gemfile', 'Ruby'],
  ['makefile', 'Makefile'],
  ['rakefile', 'Ruby']
]);

const IGNORED_BASENAMES = new Set([
  'cargo.lock',
  'go.mod',
  'go.sum',
  'license',
  'package-lock.json',
  'pnpm-lock.yaml',
  'readme',
  'readme.md',
  'yarn.lock'
]);

const IGNORED_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.csv',
  '.env',
  '.eot',
  '.gif',
  '.ico',
  '.ini',
  '.jpeg',
  '.jpg',
  '.json',
  '.lock',
  '.map',
  '.md',
  '.markdown',
  '.pdf',
  '.png',
  '.snap',
  '.sum',
  '.svg',
  '.toml',
  '.tsv',
  '.ttf',
  '.txt',
  '.webp',
  '.woff',
  '.woff2',
  '.xml',
  '.yaml',
  '.yml'
]);

const LANGUAGE_COLORS = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Rust: '#dea584',
  Go: '#00add8',
  C: '#636c76',
  Python: '#3572a5',
  Swift: '#f05138',
  CSS: '#563d7c',
  HTML: '#e34c26',
  PHP: '#4f5d95',
  'C#': '#178600',
  Java: '#b07219',
  Shell: '#89e051',
  Kotlin: '#a97bff',
  Ruby: '#701516',
  'C++': '#f34b7d',
  CMake: '#da3434',
  Dart: '#00b4ab',
  Dockerfile: '#384d54',
  Elixir: '#6e4a7e',
  Makefile: '#427819',
  'Objective-C': '#438eff',
  'Objective-C++': '#6866fb',
  Scala: '#c22d40',
  Solidity: '#aa6746',
  Svelte: '#ff3e00',
  Vue: '#41b883',
  Other: '#8b5cf6'
};

const FALLBACK_LANGUAGE_COLORS = [
  '#f1e05a',
  '#3178c6',
  '#dea584',
  '#00add8',
  '#636c76',
  '#3572a5',
  '#f05138',
  '#8b5cf6'
];

const THEMES = {
  light: {
    card: '#ffffff',
    stroke: '#d0d7de',
    text: '#24292f',
    muted: '#57606a'
  },
  dark: {
    card: '#111821',
    stroke: '#30363d',
    text: '#f0f6fc',
    muted: '#8b949e'
  }
};

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const login = options.login || process.env.GITHUB_LOGIN || process.env.GITHUB_REPOSITORY_OWNER || detectLoginFromRemote();
  if (!login) {
    throw new Error('Could not determine GitHub login. Pass --login or set GITHUB_LOGIN.');
  }

  const stats = options.fixture
    ? normalizeStats(JSON.parse(await readFile(options.fixture, 'utf8')))
    : await fetchProfileStats({
      login,
      token: requireToken(),
      languageCachePath: options.languageCache || path.join(options.outDir, DEFAULT_LANGUAGE_CACHE)
    });

  await writeProfileGraphics({ outDir: options.outDir, stats, requestedSuffix: options.assetSuffix });

  if (options.commit || options.push) {
    commitAndMaybePush({ push: options.push });
  }
}

function parseArgs(args) {
  const options = {
    outDir: process.cwd(),
    login: null,
    fixture: null,
    assetSuffix: null,
    languageCache: null,
    commit: false,
    push: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--out-dir') options.outDir = requireValue(args, ++i, arg);
    else if (arg === '--login') options.login = requireValue(args, ++i, arg);
    else if (arg === '--fixture') options.fixture = requireValue(args, ++i, arg);
    else if (arg === '--asset-suffix') options.assetSuffix = sanitizeSuffix(requireValue(args, ++i, arg));
    else if (arg === '--language-cache') options.languageCache = requireValue(args, ++i, arg);
    else if (arg === '--commit') options.commit = true;
    else if (arg === '--push') {
      options.commit = true;
      options.push = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/update-profile-graphics.mjs [options]

Options:
  --login <login>          GitHub user login. Defaults to GITHUB_LOGIN or repo owner.
  --out-dir <path>         Repository root to update. Defaults to current directory.
  --asset-suffix <suffix>  Asset filename suffix. Defaults to next counter.
  --language-cache <path>  Commit language cache path. Defaults to ${DEFAULT_LANGUAGE_CACHE}.
  --fixture <path>         Render from a precomputed stats fixture instead of GitHub.
  --commit                 Commit generated changes if any.
  --push                   Commit and push generated changes if any.
`);
}

function requireToken() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GH_TOKEN or GITHUB_TOKEN is required when not using --fixture.');
  }
  return token;
}

function detectLoginFromRemote() {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const match = remote.match(/github\.com[:/]([^/]+)\/[^/]+(?:\.git)?$/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

async function fetchProfileStats({ login, token, languageCachePath }) {
  const years = await fetchContributionYears({ login, token });
  const contributionData = await fetchContributionBuckets({ login, years, token });

  const totals = contributionVisibilityTotals({ contributionData, years });
  const publicCommitRepos = new Set();

  for (const year of years) {
    const bucket = contributionData[`y${year}`];
    for (const item of bucket.commitContributionsByRepository) {
      if (!item.repository.isPrivate) publicCommitRepos.add(item.repository.nameWithOwner);
    }
  }

  const privateCommitRepos = await fetchPrivateCommitRepos({ login, token });
  const allCommitRepos = [...new Set([...publicCommitRepos, ...privateCommitRepos])];
  const languageBytes = await fetchCommitLanguageTotals({
    repos: allCommitRepos,
    login,
    token,
    cachePath: languageCachePath,
    since: `${Math.min(...years)}-01-01T00:00:00Z`
  });

  return normalizeStats({
    user: login,
    generatedAt: new Date().toISOString(),
    years,
    totals,
    commitRepos: {
      publicVisible: publicCommitRepos.size,
      privateReadable: privateCommitRepos.length,
      totalReadable: allCommitRepos.length
    },
    languageBytes
  });
}

async function fetchContributionYears({ login, token }) {
  const data = await graphql({
    token,
    query: `query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionYears
        }
      }
    }`,
    variables: { login }
  });

  const years = data.user?.contributionsCollection?.contributionYears;
  if (!Array.isArray(years) || years.length === 0) {
    throw new Error(`No contribution years found for ${login}.`);
  }
  return [...years].sort((a, b) => a - b);
}

async function fetchContributionBuckets({ login, years, token }) {
  const currentYear = Math.max(...years);
  const now = new Date().toISOString();
  const fields = years.map((year) => {
    const from = `${year}-01-01T00:00:00Z`;
    const to = year === currentYear ? now : `${year + 1}-01-01T00:00:00Z`;
    return `y${year}: contributionsCollection(from: "${from}", to: "${to}") {
      contributionCalendar { totalContributions }
      restrictedContributionsCount
      commitContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner isPrivate }
        contributions(first: 1) { totalCount }
      }
      issueContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner isPrivate }
        contributions(first: 1) { totalCount }
      }
      pullRequestContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner isPrivate }
        contributions(first: 1) { totalCount }
      }
      pullRequestReviewContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner isPrivate }
        contributions(first: 1) { totalCount }
      }
      repositoryContributions(first: 100) {
        nodes { repository { nameWithOwner isPrivate } }
      }
    }`;
  }).join('\n');

  const data = await graphql({
    token,
    query: `query($login: String!) {
      user(login: $login) {
        ${fields}
      }
    }`,
    variables: { login }
  });

  return data.user;
}

async function fetchPrivateCommitRepos({ login, token }) {
  let privateRepos = [];
  try {
    privateRepos = await paginateRest({
      token,
      pathName: '/user/repos',
      params: {
        visibility: 'private',
        affiliation: 'owner,collaborator,organization_member',
        per_page: '100'
      }
    });
  } catch (error) {
    if (isRateLimitError(error)) throw error;
    console.warn(`Skipping private commit repository data: ${error.message}`);
    return [];
  }

  const repos = await mapLimit(privateRepos, 4, async (repo) => {
    try {
      const commits = await restJson({
        token,
        pathName: `/repos/${repo.full_name}/commits`,
        params: { author: login, per_page: '1' }
      });
      return Array.isArray(commits) && commits.length > 0 ? repo.full_name : null;
    } catch (error) {
      if (isRateLimitError(error)) throw error;
      // Empty, archived, or inaccessible repositories are not useful for this chart.
      return null;
    }
  });
  return repos.filter(Boolean);
}

async function fetchCommitLanguageTotals({ repos, login, token, cachePath, since }) {
  console.log(`Collecting changed-file languages from ${repos.length} readable commit repositories.`);
  const cache = await loadCommitLanguageCache(cachePath);
  const commitGroups = await mapLimit(repos, 4, async (repo) => listAuthoredCommits({
    repo,
    login,
    token,
    since
  }));
  const commits = commitGroups.flat();
  console.log(`Inspecting ${commits.length} authored commits for changed source files.`);
  let cacheMisses = 0;
  let savedMisses = 0;
  const commitLanguageEntries = [];

  for (let i = 0; i < commits.length; i += 100) {
    const batch = commits.slice(i, i + 100);
    const batchLanguageEntries = await mapLimit(batch, 4, async ({ repo, sha }) => {
      const key = commitCacheKey({ repo, sha });
      if (cache.commits[key]) return cache.commits[key];

      try {
        const commit = await restJson({ token, pathName: `/repos/${repo}/commits/${sha}` });
        const files = (commit.files || []).map((file) => ({
            filename: file.filename,
            additions: Number(file.additions || 0),
            deletions: Number(file.deletions || 0),
            changes: Number(file.changes || 0)
          }));
        const entry = {
          languages: languageTotalsFromCommitFileChanges([{ files }])
        };
        cache.commits[key] = entry;
        cacheMisses += 1;
        return entry;
      } catch (error) {
        if (isRateLimitError(error)) throw error;
        return { languages: [] };
      }
    });

    commitLanguageEntries.push(...batchLanguageEntries);
    if (cacheMisses > savedMisses) {
      await saveCommitLanguageCache(cachePath, cache);
      savedMisses = cacheMisses;
    }
    console.log(`Inspected ${Math.min(i + batch.length, commits.length)}/${commits.length} commits (${cacheMisses} fetched).`);
  }

  return languageTotalsFromCommitLanguageEntries(commitLanguageEntries);
}

function commitCacheKey({ repo, sha }) {
  return createHash('sha256').update(`${repo}@${sha}`).digest('hex');
}

function isRateLimitError(error) {
  return /rate limit|secondary rate|abuse detection/i.test(error.message || '');
}

async function listAuthoredCommits({ repo, login, token, since }) {
  try {
    const params = { author: login, per_page: '100' };
    if (since) params.since = since;
    const commits = await paginateRest({ token, pathName: `/repos/${repo}/commits`, params });
    return commits.map((commit) => ({ repo, sha: commit.sha })).filter((commit) => commit.sha);
  } catch (error) {
    if (isRateLimitError(error)) throw error;
    // Repositories can disappear or become inaccessible after the contribution was made.
    return [];
  }
}

async function loadCommitLanguageCache(cachePath) {
  try {
    const cache = JSON.parse(await readFile(cachePath, 'utf8'));
    if (cache.version === COMMIT_LANGUAGE_CACHE_VERSION && cache.commits && typeof cache.commits === 'object') {
      return cache;
    }
  } catch {
    // Missing or invalid cache; rebuild it from GitHub.
  }
  return { version: COMMIT_LANGUAGE_CACHE_VERSION, commits: {} };
}

async function saveCommitLanguageCache(cachePath, cache) {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function graphql({ token, query, variables }) {
  const response = await fetch(`${API_ROOT}/graphql`, {
    method: 'POST',
    headers: apiHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({ query, variables })
  });
  const payload = await response.json();
  if (!response.ok || payload.errors) {
    const detail = payload.errors?.map((error) => error.message).join('; ') || response.statusText;
    throw new Error(`GitHub GraphQL request failed: ${detail}`);
  }
  return payload.data;
}

async function paginateRest({ token, pathName, params = {} }) {
  const results = [];
  let page = 1;
  while (true) {
    const data = await restJson({ token, pathName, params: { ...params, page: String(page) } });
    if (!Array.isArray(data)) return results;
    results.push(...data);
    if (data.length < Number(params.per_page || 30)) return results;
    page += 1;
  }
}

async function restJson({ token, pathName, params = {} }) {
  const url = new URL(`${API_ROOT}${pathName}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: apiHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      message = (await response.json()).message || message;
    } catch {
      // Keep the HTTP status text.
    }
    throw new Error(`${pathName} failed (${response.status}): ${message}`);
  }
  return response.json();
}

function apiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT
  };
}

function normalizeStats(input) {
  if (input.contributionBuckets) {
    return normalizeStats({
      ...input,
      contributionBuckets: undefined,
      totals: contributionVisibilityTotals({
        contributionData: input.contributionBuckets,
        years: input.years || []
      })
    });
  }

  const rawLanguageBytes = input.commitFileChanges
    ? languageTotalsFromCommitFileChanges(input.commitFileChanges)
    : input.languageBytes || [];
  const languageBytes = [...rawLanguageBytes].sort((a, b) => b.bytes - a.bytes);
  const topLanguages = input.topLanguages || topLanguageSlices(languageBytes);
  const totals = normalizeTotals(input.totals);
  return {
    user: input.user,
    generatedAt: input.generatedAt || new Date().toISOString(),
    years: input.years || [],
    totals,
    commitRepos: input.commitRepos || {},
    languageBytes,
    readableLanguageCount: input.readableLanguageCount || languageBytes.length,
    topLanguages
  };
}

function languageTotalsFromCommitFileChanges(commitFileChanges) {
  const totals = new Map();
  for (const changeSet of commitFileChanges || []) {
    for (const file of changeSet.files || []) {
      const language = languageForPath(file.filename);
      if (!language) continue;

      const additions = Number(file.additions || 0);
      const deletions = Number(file.deletions || 0);
      const changes = additions + deletions || Number(file.changes || 0);
      if (changes <= 0) continue;
      totals.set(language, (totals.get(language) || 0) + changes);
    }
  }
  return [...totals.entries()]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes);
}

function languageTotalsFromCommitLanguageEntries(entries) {
  const totals = new Map();
  for (const entry of entries || []) {
    for (const language of entry.languages || []) {
      const bytes = Number(language.bytes || 0);
      if (bytes <= 0) continue;
      totals.set(language.name, (totals.get(language.name) || 0) + bytes);
    }
  }
  return [...totals.entries()]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes);
}

function languageForPath(filename) {
  const normalized = String(filename || '').replaceAll('\\', '/');
  const basename = normalized.split('/').pop()?.toLowerCase();
  if (!basename || IGNORED_BASENAMES.has(basename)) return null;
  if (LANGUAGE_BY_BASENAME.has(basename)) return LANGUAGE_BY_BASENAME.get(basename);

  const extension = languageExtension(basename);
  if (!extension || IGNORED_EXTENSIONS.has(extension)) return null;
  return LANGUAGE_BY_EXTENSION.get(extension) || null;
}

function languageExtension(basename) {
  if (basename.endsWith('.d.ts')) return '.ts';
  return path.extname(basename);
}

function contributionVisibilityTotals({ contributionData, years }) {
  const totals = {
    total: 0,
    publicVisible: 0,
    privateTotal: 0
  };

  for (const year of years) {
    const bucket = contributionData[`y${year}`];
    if (!bucket) continue;

    const yearTotals = contributionBucketVisibilityTotals(bucket);
    totals.publicVisible += yearTotals.publicVisible;
    totals.privateTotal += yearTotals.privateTotal;
  }

  totals.total = totals.publicVisible + totals.privateTotal;
  return totals;
}

function contributionBucketVisibilityTotals(bucket) {
  const totals = {
    publicVisible: 0,
    privateTotal: Number(bucket.restrictedContributionsCount || 0)
  };

  for (const group of REPOSITORY_CONTRIBUTION_GROUPS) {
    for (const item of bucket[group] || []) {
      addRepositoryContribution(totals, item.repository, item.contributions?.totalCount);
    }
  }

  for (const item of bucket.repositoryContributions?.nodes || []) {
    addRepositoryContribution(totals, item.repository, 1);
  }

  return totals;
}

function addRepositoryContribution(totals, repository, count) {
  const value = Number(count || 0);
  if (value <= 0 || !repository) return;

  if (repository.isPrivate) totals.privateTotal += value;
  else totals.publicVisible += value;
}

function normalizeTotals(totals = {}) {
  const publicVisible = Number(totals.publicVisible || 0);
  const privateTotal = Number(totals.privateTotal ?? totals.privateVisible ?? totals.privateRestricted ?? 0);
  const total = Number(totals.total ?? publicVisible + privateTotal);
  return { total, publicVisible, privateTotal };
}

function topLanguageSlices(languageBytes) {
  const top = languageBytes.slice(0, 7);
  const otherBytes = languageBytes.slice(7).reduce((sum, language) => sum + language.bytes, 0);
  if (otherBytes > 0) top.push({ name: 'Other', bytes: otherBytes });
  return top;
}

async function writeProfileGraphics({ outDir, stats, requestedSuffix }) {
  const assetsDir = path.join(outDir, 'assets');
  await mkdir(assetsDir, { recursive: true });

  const suffix = requestedSuffix || await nextAssetSuffix(assetsDir);
  const lightAsset = `github-activity-light-${suffix}.svg`;
  const darkAsset = `github-activity-dark-${suffix}.svg`;

  await cleanupOldAssets(assetsDir, new Set([lightAsset, darkAsset]));
  await writeFile(path.join(assetsDir, lightAsset), renderSvg({ stats, themeName: 'light' }));
  await writeFile(path.join(assetsDir, darkAsset), renderSvg({ stats, themeName: 'dark' }));
  await writeFile(path.join(outDir, 'README.md'), renderReadme({ lightAsset, darkAsset }));

  console.log(`Wrote ${path.join('assets', lightAsset)}`);
  console.log(`Wrote ${path.join('assets', darkAsset)}`);
}

async function cleanupOldAssets(assetsDir, keep) {
  let entries = [];
  try {
    entries = await readdir(assetsDir);
  } catch {
    return;
  }
  await Promise.all(entries
    .filter((entry) => GENERATED_ASSET_RE.test(entry) && !keep.has(entry))
    .map((entry) => rm(path.join(assetsDir, entry))));
}

async function nextAssetSuffix(assetsDir) {
  let max = 0;
  for (const entry of await readdir(assetsDir)) {
    const match = entry.match(COUNTER_ASSET_RE);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `v${String(max + 1).padStart(4, '0')}`;
}

function renderReadme({ lightAsset, darkAsset }) {
  return `<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/${darkAsset}">
    <img src="assets/${lightAsset}" width="980" alt="GitHub activity breakdown showing public and private contributions plus changed-file language usage">
  </picture>
</div>
`;
}

function renderSvg({ stats, themeName }) {
  const theme = THEMES[themeName];
  const totalContributions = stats.totals.total;
  const contribItems = [
    { label: 'Public', value: stats.totals.publicVisible, color: '#2fb8a6' },
    { label: 'Private', value: stats.totals.privateTotal, color: '#7c3aed' }
  ];
  const languageItems = stats.topLanguages.map((language, index) => ({
    ...language,
    color: languageColor(language.name, index)
  }));
  const languageTotal = languageItems.reduce((sum, language) => sum + language.bytes, 0);
  const languageLegend = languageItems.map((language, index) => {
    return legendOneLine({
      x: 780,
      y: 140 + index * 20,
      color: language.color,
      label: language.name,
      percentage: percent(language.bytes, languageTotal),
      theme
    });
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="980" height="225" viewBox="0 0 980 225" role="img" aria-labelledby="title desc">
  <title id="title">GitHub activity breakdown for ${escapeXml(stats.user)}</title>
  <desc id="desc">Two pie charts showing public versus private contributions and changed-file language breakdown.</desc>
  <defs>
    <style>
      text { font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, sans-serif; }
      .section { font-size: 16px; font-weight: 700; letter-spacing: 0; }
      .body { font-size: 13px; font-weight: 650; letter-spacing: 0; }
      .muted { font-size: 12px; font-weight: 500; letter-spacing: 0; }
      .centerBig { font-size: 22px; font-weight: 780; letter-spacing: 0; }
      .centerSmall { font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; }
    </style>
  </defs>

  <rect x="38" y="12.5" width="430" height="212" rx="12" fill="${theme.card}" stroke="${theme.stroke}"/>
  <rect x="512" y="12.5" width="430" height="212" rx="12" fill="${theme.card}" stroke="${theme.stroke}"/>

  <g transform="translate(0 -76)">
  <text x="62" y="119" class="section" fill="${theme.text}">Public / private</text>
  <g>
    ${pie(162, 211, 72, contribItems)}
    <circle cx="162" cy="211" r="42" fill="${theme.card}" stroke="${theme.stroke}"/>
    <text x="162" y="207" text-anchor="middle" class="centerBig" fill="${theme.text}">${compact(totalContributions)}</text>
    <text x="162" y="226" text-anchor="middle" class="centerSmall" fill="${theme.muted}">contribs</text>
  </g>
  ${legendTwoLine({
    x: 276,
    y: 170,
    color: '#7c3aed',
    label: 'Private',
    value: formatInteger(stats.totals.privateTotal),
    percentage: percent(stats.totals.privateTotal, totalContributions),
    theme
  })}
  ${legendTwoLine({
    x: 276,
    y: 222,
    color: '#2fb8a6',
    label: 'Public',
    value: formatInteger(stats.totals.publicVisible),
    percentage: percent(stats.totals.publicVisible, totalContributions),
    theme
  })}
  <text x="536" y="119" class="section" fill="${theme.text}">Language mix</text>
  <g>
    ${pie(632, 211, 72, languageItems)}
    <circle cx="632" cy="211" r="42" fill="${theme.card}" stroke="${theme.stroke}"/>
    <text x="632" y="207" text-anchor="middle" class="centerBig" fill="${theme.text}">${formatInteger(stats.readableLanguageCount)}</text>
    <text x="632" y="226" text-anchor="middle" class="centerSmall" fill="${theme.muted}">languages</text>
  </g>
  ${languageLegend}
  </g>
</svg>
`;
}

function pie(cx, cy, radius, items) {
  const total = items.reduce((sum, item) => sum + sliceValue(item), 0);
  if (total <= 0) return '';

  let angle = 0;
  return items.map((item) => {
    const value = sliceValue(item);
    const next = angle + (value / total) * 360;
    const pathData = slicePath(cx, cy, radius, angle, next);
    angle = next;
    return `<path d="${pathData}" fill="${item.color}"/>`;
  }).join('\n    ');
}

function sliceValue(item) {
  return Number(item.value ?? item.bytes ?? 0);
}

function slicePath(cx, cy, radius, startAngle, endAngle) {
  const [x1, y1] = polar(cx, cy, radius, startAngle);
  const [x2, y2] = polar(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`;
}

function polar(cx, cy, radius, angle) {
  const radians = (angle - 90) * Math.PI / 180;
  return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)];
}

function legendTwoLine({ x, y, color, label, value, percentage, theme }) {
  return `
    <g transform="translate(${x} ${y})">
      <rect x="0" y="-10" width="10" height="10" rx="2" fill="${color}"/>
      <text x="18" y="-8" class="body" fill="${theme.text}">${escapeXml(label)}</text>
      <text x="18" y="10" class="muted" fill="${theme.muted}">${escapeXml(value)} / ${percentage}</text>
    </g>`;
}

function legendOneLine({ x, y, color, label, percentage, theme }) {
  return `
    <g transform="translate(${x} ${y})">
      <rect x="0" y="-8" width="9" height="9" rx="2" fill="${color}"/>
      <text x="17" y="0" class="body" fill="${theme.text}">${escapeXml(label)}</text>
      <text x="132" y="0" text-anchor="end" class="muted" fill="${theme.muted}">${percentage}</text>
    </g>`;
}

function languageColor(language, index) {
  return LANGUAGE_COLORS[language] || FALLBACK_LANGUAGE_COLORS[index % FALLBACK_LANGUAGE_COLORS.length];
}

function compact(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

function percent(value, total) {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%';
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function sanitizeSuffix(suffix) {
  const sanitized = suffix.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-');
  if (!sanitized) throw new Error('Asset suffix must contain at least one filename-safe character.');
  return sanitized;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function commitAndMaybePush({ push }) {
  if (process.env.GITHUB_ACTIONS) {
    runGit(['config', 'user.name', 'github-actions[bot]']);
    runGit(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  }

  runGit(['add', 'README.md', 'assets']);
  const hasChanges = spawnSync('git', ['diff', '--cached', '--quiet'], { stdio: 'inherit' }).status !== 0;
  if (!hasChanges) {
    console.log('No profile graphic changes to commit.');
    return;
  }

  runGit(['commit', '-m', 'Update profile activity graphics']);
  if (push) runGit(['push']);
}

function runGit(args) {
  const result = spawnSync('git', args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
}

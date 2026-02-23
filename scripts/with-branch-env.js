#!/usr/bin/env node

const { execSync, spawn } = require('child_process');

const DEFAULT_DEV_CHAT_PROXY_APP_ID = 'chat-proxy-dev';
const MAX_CHAT_PROXY_APP_ID_LENGTH = 63;

const slugifyBranchName = (branchName) => {
  const normalized = String(branchName || '')
    .trim()
    .toLowerCase()
    .replaceAll('_', '-')
    .replaceAll('/', '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'branch';
};

const makeDevAppId = (branchName, prefix = DEFAULT_DEV_CHAT_PROXY_APP_ID) => {
  const branchSlug = slugifyBranchName(branchName);
  const suffixBudget = MAX_CHAT_PROXY_APP_ID_LENGTH - prefix.length - 1;
  if (suffixBudget <= 0) {
    return prefix.slice(0, MAX_CHAT_PROXY_APP_ID_LENGTH);
  }
  const trimmedSlug = branchSlug.slice(0, suffixBudget);
  return trimmedSlug ? `${prefix}-${trimmedSlug}` : prefix;
};

const readGitBranch = () => {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
};

const pickBranchName = () => {
  const candidates = [
    process.env.REACT_APP_CHAT_PROXY_BRANCH,
    process.env.REACT_APP_BRANCH_NAME,
    process.env.REACT_APP_GITHUB_HEAD_REF,
    process.env.REACT_APP_GITHUB_REF_NAME,
    process.env.REACT_APP_VERCEL_GIT_COMMIT_REF,
    process.env.REACT_APP_CI_COMMIT_REF_NAME,
    process.env.REACT_APP_BRANCH,
    process.env.GITHUB_HEAD_REF,
    process.env.GITHUB_REF_NAME,
    process.env.VERCEL_GIT_COMMIT_REF,
    process.env.CI_COMMIT_REF_NAME,
    readGitBranch(),
  ];

  for (const candidate of candidates) {
    const cleaned = String(candidate || '').trim();
    if (!cleaned || cleaned === 'HEAD') continue;
    return cleaned;
  }

  return 'main';
};

const branchName = pickBranchName();
const computedBranchAppId = makeDevAppId(branchName);

const childEnv = {
  ...process.env,
  REACT_APP_BRANCH_NAME: process.env.REACT_APP_BRANCH_NAME || branchName,
  REACT_APP_CHAT_PROXY_BRANCH: process.env.REACT_APP_CHAT_PROXY_BRANCH || branchName,
  REACT_APP_CHAT_PROXY_BRANCH_APP_ID:
    process.env.REACT_APP_CHAT_PROXY_BRANCH_APP_ID || computedBranchAppId,
};

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('Usage: node scripts/with-branch-env.js <command> [args...]');
  process.exit(1);
}

const child = spawn(argv[0], argv.slice(1), {
  stdio: 'inherit',
  env: childEnv,
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

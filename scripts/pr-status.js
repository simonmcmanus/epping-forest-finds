#!/usr/bin/env node
// Deterministic, read-only PR status collection. Only changed state needs an agent.
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const QUERY = `query($owner:String!,$name:String!,$number:Int!) {
  repository(owner:$owner,name:$name) {
    pullRequest(number:$number) {
      number url state isDraft headRefOid baseRefOid mergeable reviewDecision
      commits(last:1) { nodes { commit { oid statusCheckRollup { contexts(first:100) {
        pageInfo { hasNextPage }
        nodes {
          __typename
          ... on CheckRun { name status conclusion detailsUrl checkSuite { app { slug } } }
          ... on StatusContext { context state targetUrl creator { login } }
        }
      } } } } }
      reviews(last:100) { pageInfo { hasPreviousPage } nodes {
        id updatedAt author { login __typename } state commit { oid }
      } }
      comments(last:100) { pageInfo { hasPreviousPage } nodes { id updatedAt author { login __typename } } }
      reviewThreads(first:100) { pageInfo { hasNextPage } nodes {
        id isResolved isOutdated path line
        comments(first:100) { pageInfo { hasNextPage } nodes { id updatedAt author { login __typename } } }
      } }
    }
  }
}`;

function summarize(data) {
  if (data.errors?.length) throw new Error('GitHub returned GraphQL errors; status is incomplete.');
  const pr = data.data?.repository?.pullRequest;
  if (!pr) throw new Error('Pull request was not returned by GitHub.');
  const commit = pr.commits?.nodes?.[0]?.commit;
  if (commit?.oid !== pr.headRefOid) throw new Error('Head changed during collection; collect again.');
  const contexts = commit.statusCheckRollup?.contexts;
  if (contexts?.pageInfo?.hasNextPage || pr.reviews?.pageInfo?.hasPreviousPage || pr.comments?.pageInfo?.hasPreviousPage || pr.reviewThreads?.pageInfo?.hasNextPage || pr.reviewThreads?.nodes?.some(thread => thread.comments?.pageInfo?.hasNextPage)) {
    throw new Error('Status exceeds 100 checks, reviews, comments or threads; inspect paginated GitHub data before acting.');
  }
  const checks = (contexts?.nodes || []).map(check => check.__typename === 'CheckRun'
    ? { name: check.name, provider: check.checkSuite?.app?.slug || '', state: check.status === 'COMPLETED' ? check.conclusion : check.status, url: check.detailsUrl || null }
    : { name: check.context, provider: check.creator?.login || '', state: check.state, url: check.targetUrl || null }
  ).sort((a, b) => `${a.name}:${a.provider}`.localeCompare(`${b.name}:${b.provider}`));
  const latest = new Map();
  for (const review of pr.reviews?.nodes || []) {
    if (review.author && review.state !== 'COMMENTED' && review.state !== 'PENDING') {
      latest.set(review.author.login, {
        author: review.author.login, bot: review.author.__typename === 'Bot',
        state: review.state, currentHead: review.commit?.oid === pr.headRefOid,
      });
    }
  }
  const reviews = [...latest.values()].sort((a, b) => a.author.localeCompare(b.author));
  const threads = (pr.reviewThreads?.nodes || []).filter(thread => !thread.isResolved)
    .map(({ id, isOutdated, path: file, line }) => ({ id, outdated: isOutdated, file, line }))
    .sort((a, b) => a.id.localeCompare(b.id));
  // Bodies stay in GitHub; identities and edit times are enough to wake the
  // steward for human feedback, including comments that do not change a verdict.
  const humanActivity = (nodes, kind) => (nodes || [])
    .filter(item => item.author?.__typename === 'User')
    .map(item => ({ kind, id: item.id, updatedAt: item.updatedAt, author: item.author.login }));
  const discussion = [
    ...humanActivity(pr.comments?.nodes, 'comment'),
    ...humanActivity(pr.reviews?.nodes, 'review'),
    ...(pr.reviewThreads?.nodes || []).flatMap(thread => humanActivity(thread.comments?.nodes, 'thread-reply')),
  ].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  const pending = checks.filter(check => ['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING', 'REQUESTED', 'EXPECTED'].includes(check.state));
  const failed = checks.filter(check => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].includes(check.state));
  const unknown = checks.filter(check => !['SUCCESS', 'NEUTRAL', 'SKIPPED', ...pending.map(c => c.state), ...failed.map(c => c.state)].includes(check.state));
  const snapshot = {
    number: pr.number, url: pr.url, head: pr.headRefOid, base: pr.baseRefOid,
    state: pr.state, draft: pr.isDraft, mergeable: pr.mergeable, reviewDecision: pr.reviewDecision,
    checks, reviews, threads, discussion,
    preview: checks.find(check => check.name === 'deploy/netlify' && check.state === 'SUCCESS')?.url || null,
  };
  const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return { snapshot, fingerprint, counts: { checks: checks.length, pending: pending.length, failed: failed.length, unknown: unknown.length, unresolvedThreads: threads.length },
    needsAttention: pr.state === 'OPEN' && (failed.length > 0 || unknown.length > 0 || threads.length > 0 || pr.mergeable === 'CONFLICTING' || pr.reviewDecision === 'CHANGES_REQUESTED'),
    checksSettled: checks.length > 0 && !pending.length && !unknown.length,
  };
}

function changedStatus(data, previous) {
  const result = summarize(data);
  const changed = result.fingerprint !== previous?.fingerprint;
  const feedbackChanged = result.snapshot.discussion.length > 0 &&
    JSON.stringify(result.snapshot.discussion) !== JSON.stringify(previous?.snapshot?.discussion || []);
  return { changed, notify: changed && (result.needsAttention || result.checksSettled || feedbackChanged || result.snapshot.state !== 'OPEN'), ...result };
}

function collect({ number, repository, run = execFileSync }) {
  const [owner, name, extra] = repository.split('/');
  if (!owner || !name || extra || !Number.isSafeInteger(number) || number < 1) throw new Error('Use a positive PR number and owner/repository.');
  return JSON.parse(run('gh', ['api', 'graphql', '-f', `query=${QUERY}`, '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }));
}

function main(args) {
  const number = Number(args.shift());
  let repository;
  let stateFile;
  while (args.length) {
    const option = args.shift();
    if (option === '--repo') repository = args.shift();
    else if (option === '--state') stateFile = args.shift();
    else throw new Error('Usage: node scripts/pr-status.js <PR> [--repo owner/repo] [--state /tmp/pr-state.json]');
    if (!repository && option === '--repo' || !stateFile && option === '--state') throw new Error(`Missing value for ${option}`);
  }
  if (!repository) repository = JSON.parse(execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], { encoding: 'utf8' })).nameWithOwner;
  let previous;
  if (stateFile && fs.existsSync(stateFile)) previous = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const result = changedStatus(collect({ number, repository }), previous);
  if (stateFile) {
    fs.mkdirSync(path.dirname(path.resolve(stateFile)), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ fingerprint: result.fingerprint, head: result.snapshot.head, snapshot: { discussion: result.snapshot.discussion } }), { mode: 0o600 });
    fs.renameSync(temporary, stateFile);
  }
  // A no-op emits no repeated checks, logs or conversation context.
  console.log(JSON.stringify(result.changed ? result : { changed: false, notify: false, head: result.snapshot.head }));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`PR status unavailable: ${error.message}`); process.exitCode = 1; }
}
module.exports = { collect, summarize, changedStatus };

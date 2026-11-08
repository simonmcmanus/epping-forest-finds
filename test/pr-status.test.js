const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collect, summarize, changedStatus } = require('../scripts/pr-status');

function response() {
  return { data: { repository: { pullRequest: {
    number: 1, url: 'https://github.com/example/repo/pull/1', state: 'OPEN', isDraft: false,
    headRefOid: 'head', baseRefOid: 'base', mergeable: 'MERGEABLE', reviewDecision: 'REVIEW_REQUIRED',
    commits: { nodes: [{ commit: { oid: 'head', statusCheckRollup: { contexts: { pageInfo: { hasNextPage: false }, nodes: [
      { __typename: 'CheckRun', name: 'Unit tests', status: 'COMPLETED', conclusion: 'SUCCESS', checkSuite: { app: { slug: 'actions' } } },
    ] } } } }] },
    reviews: { pageInfo: { hasPreviousPage: false }, nodes: [] },
    reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] },
  } } } };
}
const pr = value => value.data.repository.pullRequest;

test('unchanged settled checks produce no new notification', () => {
  const data = response();
  const first = changedStatus(data);
  assert.equal(first.notify, true);
  assert.equal(first.snapshot.reviewDecision, 'REVIEW_REQUIRED');
  const second = changedStatus(data, first);
  assert.equal(second.changed, false);
  assert.equal(second.notify, false);
});
test('a completed failure wakes the steward but a new pending head waits', () => {
  const data = response();
  const check = pr(data).commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0];
  check.status = 'IN_PROGRESS'; check.conclusion = null;
  const pending = changedStatus(data);
  assert.equal(pending.notify, false);
  assert.equal(pending.counts.pending, 1);
  check.status = 'COMPLETED'; check.conclusion = 'FAILURE';
  const failed = changedStatus(data, pending);
  assert.equal(failed.notify, true);
  assert.equal(failed.counts.failed, 1);
});
test('outdated unresolved findings remain visible and new threads change state', () => {
  const data = response();
  const before = changedStatus(data);
  pr(data).reviewThreads.nodes.push({ id: 'thread1', isResolved: false, isOutdated: true, path: 'js/app.js', line: 4 });
  const after = changedStatus(data, before);
  assert.equal(after.notify, true);
  assert.equal(after.snapshot.threads[0].outdated, true);
});
test('partial or inconsistent GitHub responses never establish a clean status', () => {
  const data = response();
  pr(data).reviewThreads.pageInfo.hasNextPage = true;
  assert.throws(() => summarize(data), /exceeds 100/);
  pr(data).reviewThreads.pageInfo.hasNextPage = false;
  pr(data).headRefOid = 'new-head';
  assert.throws(() => summarize(data), /Head changed/);
  assert.throws(() => summarize({ errors: [{ message: 'permission denied' }] }), /incomplete/);
});
test('bot approval is distinguished from a human and stale approval', () => {
  const data = response();
  pr(data).reviews.nodes.push(
    { author: { login: 'reviewer', __typename: 'User' }, state: 'APPROVED', commit: { oid: 'old' } },
    { author: { login: 'actions[bot]', __typename: 'Bot' }, state: 'APPROVED', commit: { oid: 'head' } },
  );
  assert.deepEqual(summarize(data).snapshot.reviews.map(({ bot, currentHead }) => [bot, currentHead]), [[true, true], [false, false]]);
});
test('legacy preview URLs and check-list ordering are stable', () => {
  const data = response();
  const nodes = pr(data).commits.nodes[0].commit.statusCheckRollup.contexts.nodes;
  nodes.push({ __typename: 'StatusContext', context: 'deploy/netlify', state: 'SUCCESS', targetUrl: 'https://preview.example/', creator: { login: 'netlify' } });
  const before = summarize(data);
  nodes.reverse();
  assert.equal(summarize(data).fingerprint, before.fingerprint);
  assert.equal(before.snapshot.preview, 'https://preview.example/');
});
test('collector uses a read-only API with validated positional inputs', () => {
  const expected = response();
  const actual = collect({ number: 5, repository: 'example/repo', run: (command, args) => {
    assert.equal(command, 'gh');
    assert.deepEqual(args.slice(0, 2), ['api', 'graphql']);
    assert.ok(args.includes('number=5'));
    assert.ok(args.includes('owner=example'));
    return JSON.stringify(expected);
  } });
  assert.deepEqual(actual, expected);
  assert.throws(() => collect({ number: 0, repository: 'example/repo' }), /positive/);
});

test('a new human request wakes the steward while checks are still pending', () => {
  const data = response();
  pr(data).commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].status = 'IN_PROGRESS';
  pr(data).comments = { pageInfo: { hasPreviousPage: false }, nodes: [] };
  const before = changedStatus(data);
  pr(data).comments.nodes.push({ id: 'comment1', updatedAt: '2026-11-07T08:00:00Z', author: { login: 'human', __typename: 'User' } });
  const after = changedStatus(data, before);
  assert.equal(after.changed, true);
  assert.equal(after.notify, true);
  assert.equal(changedStatus(data, after).notify, false);
});

test('thread replies, edits and COMMENTED reviews remain observable without changed verdicts', () => {
  const data = response();
  const activity = { id: 'reply1', updatedAt: '2026-11-07T08:00:00Z', author: { login: 'human', __typename: 'User' } };
  pr(data).reviewThreads.nodes.push({ id: 'thread1', isResolved: false, isOutdated: false, path: 'js/app.js', line: 4, comments: { nodes: [] } });
  const before = changedStatus(data);
  pr(data).reviewThreads.nodes[0].comments.nodes.push(activity);
  const replied = changedStatus(data, before);
  assert.equal(replied.notify, true);
  activity.updatedAt = '2026-11-07T08:01:00Z';
  const edited = changedStatus(data, replied);
  assert.equal(edited.changed, true);
  pr(data).reviews.nodes.push({ ...activity, id: 'review1', state: 'COMMENTED', commit: { oid: 'head' } });
  const reviewed = changedStatus(data, edited);
  assert.equal(reviewed.notify, true);
});

test('bot conversation chatter does not change the status fingerprint', () => {
  const data = response();
  const before = changedStatus(data);
  pr(data).comments = { nodes: [{ id: 'bot1', updatedAt: '2026-11-07T08:00:00Z', author: { login: 'actions[bot]', __typename: 'Bot' } }] };
  assert.equal(changedStatus(data, before).changed, false);
});

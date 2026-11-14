const { test } = require('node:test');
const assert = require('node:assert/strict');
const decide = require('../scripts/weekly-ledger-schedule.cjs');

const LEDGER_JOB = "Research, propose and open this week's Ledger PR";
const SATURDAY = new Date('2026-11-14T04:23:00Z');
const context = {
  eventName: 'schedule', runId: 999,
  repo: { owner: 'example', repo: 'forest' },
  payload: { repository: { default_branch: 'main' } },
};
const run = (id, overrides = {}) => ({
  id, head_branch: 'main', conclusion: 'success',
  created_at: '2026-11-14T01:00:00Z', html_url: `https://github.com/example/forest/actions/runs/${id}`,
  ...overrides,
});
const job = (conclusion = 'success', name = LEDGER_JOB) => ({ name, conclusion });

function fixture(runs = [], jobs = {}) {
  const calls = [];
  const listWorkflowRuns = Symbol('runs');
  const listJobsForWorkflowRun = Symbol('jobs');
  const github = {
    rest: { actions: { listWorkflowRuns, listJobsForWorkflowRun } },
    async paginate(method, parameters) {
      calls.push({ method, parameters });
      // All supplied pages are returned, as Octokit's paginate helper does.
      return method === listWorkflowRuns ? runs.flat() : (jobs[parameters.run_id] || []).flat();
    },
  };
  return { github, context, now: SATURDAY, calls };
}

test('first scheduled run is eligible when there is no successful history', async () => {
  const data = fixture();
  assert.equal((await decide(data)).run, true);
  assert.deepEqual(data.calls[0].parameters, {
    owner: 'example', repo: 'forest', workflow_id: 'weekly-ledger.yml', branch: 'main',
    status: 'success', created: '2026-11-14T00:00:00.000Z..2026-11-14T04:23:00.000Z', per_page: 100,
  });
});

test('a usage-limit failure leaves the next window eligible for retry', async () => {
  const data = fixture([run(1, { conclusion: 'failure' })], { 1: [job('failure')] });
  assert.equal((await decide(data)).run, true);
});

test('a successful Ledger job suppresses further scheduled attempts', async () => {
  const data = fixture([run(1)], { 1: [job()] });
  const result = await decide(data);
  assert.equal(result.run, false);
  assert.match(result.reason, /actions\/runs\/1/);
});

test('green workflows with skipped Ledger jobs do not suppress retry', async () => {
  const data = fixture([run(1)], { 1: [job('skipped'), job('success', 'Check whether this week is complete')] });
  assert.equal((await decide(data)).run, true);
});

test('Sunday retries belong to the same Saturday edition', async () => {
  const data = fixture([run(1)], { 1: [job()] });
  data.now = new Date('2026-11-15T10:23:00Z');
  assert.equal((await decide(data)).run, false);
  assert.match(data.calls[0].parameters.created, /^2026-11-14T00:00:00.000Z/);
});

test('the next Saturday starts a fresh edition at exactly midnight UTC', async () => {
  const data = fixture([run(1, { created_at: '2026-11-20T23:59:59Z' })], { 1: [job()] });
  data.now = new Date('2026-11-21T00:00:00Z');
  assert.equal((await decide(data)).run, true);
  assert.equal(data.calls[0].parameters.created,
    '2026-11-21T00:00:00.000Z..2026-11-21T00:00:00.000Z');
});

test('a success exactly at this edition boundary counts', async () => {
  const data = fixture([run(1, { created_at: '2026-11-14T00:00:00Z' })], { 1: [job()] });
  assert.equal((await decide(data)).run, false);
});

test('manual dispatch always runs without querying GitHub history', async () => {
  const data = fixture([run(1)], { 1: [job()] });
  data.context = { ...context, eventName: 'workflow_dispatch' };
  assert.equal((await decide(data)).run, true);
  assert.equal(data.calls.length, 0);
});

test('the current run, another branch and future runs cannot claim this edition', async () => {
  const data = fixture([
    run(999), run(2, { head_branch: 'feature' }), run(3, { created_at: '2026-11-14T10:00:00Z' }),
  ], { 999: [job()], 2: [job()], 3: [job()] });
  assert.equal((await decide(data)).run, true);
  assert.equal(data.calls.length, 1);
});

test('paginated runs and jobs find delivery beyond the first page', async () => {
  const data = fixture([[run(1)], [run(2)]], {
    1: [[job('skipped')]], 2: [[job('success', 'Preflight')], [job()]],
  });
  assert.equal((await decide(data)).run, false);
  assert.deepEqual(data.calls.slice(1).map(call => call.parameters.run_id), [1, 2]);
  assert.ok(data.calls.slice(1).every(call => call.parameters.filter === 'latest'));
});

test('history API failures fail visibly rather than spending credits without deduplication', async () => {
  const data = fixture();
  data.github.paginate = async () => { throw new Error('API unavailable'); };
  await assert.rejects(decide(data), /API unavailable/);
});

test('job API failures cannot be mistaken for an undelivered week', async () => {
  const data = fixture([run(1)]);
  const paginate = data.github.paginate;
  data.github.paginate = async (method, parameters) => {
    if (parameters.run_id) throw new Error('Job history unavailable');
    return paginate(method, parameters);
  };
  await assert.rejects(decide(data), /Job history unavailable/);
});

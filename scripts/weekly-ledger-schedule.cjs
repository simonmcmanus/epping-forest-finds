'use strict';

const LEDGER_JOB = "Research, propose and open this week's Ledger PR";

// A skipped workflow can itself be green. Count the research job, not the
// workflow conclusion, so skipped retry windows never masquerade as delivery.
module.exports = async function weeklyLedgerSchedule({ github, context, now = new Date() }) {
  if (context.eventName === 'workflow_dispatch') {
    return { run: true, reason: 'Manual run requested.' };
  }
  if (context.eventName !== 'schedule') throw new Error('Unsupported Ledger trigger.');

  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 1) % 7));
  const branch = context.payload.repository.default_branch;
  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    ...context.repo,
    workflow_id: 'weekly-ledger.yml',
    branch,
    status: 'success',
    created: `${start.toISOString()}..${now.toISOString()}`,
    per_page: 100,
  });

  for (const run of runs) {
    const created = new Date(run.created_at);
    if (run.id === context.runId || run.head_branch !== branch ||
        run.conclusion !== 'success' || !(created >= start && created <= now)) continue;
    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
      ...context.repo,
      run_id: run.id,
      filter: 'latest',
      per_page: 100,
    });
    if (jobs.some(job => job.name === LEDGER_JOB && job.conclusion === 'success')) {
      return { run: false, reason: `This week's Ledger job already succeeded: ${run.html_url}` };
    }
  }
  return { run: true, reason: 'No successful Ledger job since Saturday 00:00 UTC; attempt or retry.' };
};

// Executed only from the trusted workflow checkout.
async function updateDescription({ github, context, prNumber, expectedSha, section, log = console.info }) {
  const { data: pr } = await github.rest.pulls.get({
    owner: context.repo.owner, repo: context.repo.repo, pull_number: prNumber,
  });
  const current = (value) => value.state === 'open' && value.head.sha === expectedSha;
  const skip = () => { log('Skipping visual description update: PR is closed or its head changed.'); return false; };
  if (!current(pr)) return skip();
  const rawUrl = (repository, sha, file) =>
    `https://raw.githubusercontent.com/${repository}/${sha}/${file}`;
  const prefix = 'test/e2e/__screenshots__/';
  const files = await github.paginate(github.rest.pulls.listFiles, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: prNumber,
    per_page: 100,
  });
  const snapshots = files.filter((file) =>
    file.filename.startsWith(prefix) && file.filename.endsWith('.png'));
  const headRepository = pr.head.repo.full_name;

  const visualSection = snapshots.length
    ? [
        '### Visual changes',
        '',
        '| Snapshot | Before | After |',
        '| --- | --- | --- |',
        ...snapshots.map((file) => {
          const name = file.filename.slice(prefix.length, -'.png'.length);
          const before = file.status === 'added'
            ? '_new_'
            : `![before](${rawUrl(pr.base.repo.full_name, pr.base.sha, file.filename)})`;
          const after = file.status === 'removed'
            ? '_removed_'
            : `![after](${rawUrl(headRepository, pr.head.sha, file.filename)})`;
          return `| \`${name}\` | ${before} | ${after} |`;
        }),
      ].join('\n')
    : '';

  const replaceSection = (body, start, end, section) => {
    const marker = new RegExp(`${start}[\\s\\S]*?${end}`);
    const block = `${start}\n${section}\n${end}`;
    if (marker.test(body)) return body.replace(marker, () => block);
    if (!section) return body;
    return `${body.trim()}\n\n${block}\n`;
  };

  const apply = (body) => replaceSection(
    replaceSection(body, '<!-- visual-diffs:start -->', '<!-- visual-diffs:end -->', visualSection),
    '<!-- visual-failures:start -->', '<!-- visual-failures:end -->', section,
  );
  const request = { owner: context.repo.owner, repo: context.repo.repo, pull_number: prNumber };
  for (let attempt = 1; attempt <= 3; attempt++) {
    // Netlify or a person may have edited the body during file pagination. Always
    // reapply the visual sections to the newest body instead of discarding evidence.
    const { data: latest } = await github.rest.pulls.get(request);
    if (!current(latest)) return skip();
    const next = apply(latest.body || '');
    if (next === (latest.body || '')) return true;
    await github.rest.pulls.update({ ...request, body: next });
    const { data: verified } = await github.rest.pulls.get(request);
    if (!current(verified)) return skip();
    if (apply(verified.body || '') === (verified.body || '')) return true;
    log(`Visual sections were replaced by a concurrent body edit; attempt ${attempt} of 3.`);
  }
  throw new Error('Could not retain visual sections after three concurrent PR body edits.');
}
module.exports = { updateDescription };

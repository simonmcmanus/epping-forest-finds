// Executed only from the trusted workflow checkout.
async function updateDescription({ github, context, prNumber, expectedSha, section }) {
  const { data: pr } = await github.rest.pulls.get({
    owner: context.repo.owner, repo: context.repo.repo, pull_number: prNumber,
  });
  if (pr.state !== 'open' || pr.head.sha !== expectedSha) return false;
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

  let next = pr.body || '';
  next = replaceSection(next, '<!-- visual-diffs:start -->', '<!-- visual-diffs:end -->', visualSection);
  next = replaceSection(next, '<!-- visual-failures:start -->', '<!-- visual-failures:end -->', section);
  // Recheck after pagination too; no render from an older head should be labelled current.
  const { data: latest } = await github.rest.pulls.get({
    owner: context.repo.owner, repo: context.repo.repo, pull_number: prNumber,
  });
  if (latest.state !== 'open' || latest.head.sha !== expectedSha || latest.body !== pr.body) return false;
  if (next !== (pr.body || '')) await github.rest.pulls.update({
    owner: context.repo.owner, repo: context.repo.repo, pull_number: prNumber, body: next,
  });
  return true;
}
module.exports = { updateDescription };

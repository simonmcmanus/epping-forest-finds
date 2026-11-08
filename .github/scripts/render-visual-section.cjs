const fs = require('node:fs');
const path = require('node:path');
const escape = (value) => String(value).replace(/[\r\n|<>`\[\]]/g, ' ').replace(/@/g, '＠');

const html = (value) => escape(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const row = (name, before, after) => `<tr><th colspan="2" align="left">${html(name)}</th></tr>\n<tr><td valign="top" width="50%">${before}</td><td valign="top" width="50%">${after}</td></tr>`;

function render(candidates, destination, { repository, sha, runUrl }) {
  fs.mkdirSync(destination, { recursive: true });
  const lines = ['### Visual review', '', `Tested commit: \`${sha}\` · [CI run and reports](${runUrl})`, ''];
  const details = [];
  let imageIndex = 0;
  for (const project of ['mobile', 'desktop']) {
    const manifestPath = path.join(candidates, `visual-evidence-${project}`, 'manifest.json');
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* Missing evidence must remain visible. */ }
    const validImage = (item) => item && typeof item === 'object' && !Array.isArray(item)
      && typeof item.name === 'string' && typeof item.file === 'string' && /^[\w-]+\.png$/.test(item.file)
      && fs.existsSync(path.join(path.dirname(manifestPath), item.file))
      && fs.lstatSync(path.join(path.dirname(manifestPath), item.file)).isFile();
    const valid = manifest && manifest.version === 1 && manifest.project === project
      && typeof manifest.status === 'string'
      && Array.isArray(manifest.tests) && Array.isArray(manifest.added)
      && manifest.tests.every((test) => test && typeof test === 'object' && !Array.isArray(test)
        && typeof test.name === 'string'
        && ['passed', 'failed', 'skipped'].includes(test.status)
        && Array.isArray(test.images) && test.images.every(validImage))
      && manifest.added.every(validImage)
      && (manifest.errors === undefined || (Array.isArray(manifest.errors) && manifest.errors.every((error) => typeof error === 'string')));
    if (!valid) {
      lines.push(`**${project}: capture unavailable.** Results for this run could not be read.`, '');
      continue;
    }
    const image = (item) => {
      if (!/^[\w-]+\.png$/.test(item.file)) throw new Error('Invalid evidence filename');
      const name = `${project}-${imageIndex++}.png`;
      fs.copyFileSync(path.join(path.dirname(manifestPath), item.file), path.join(destination, name));
      return `https://raw.githubusercontent.com/${repository}/__VISUAL_SHA__/pr-${process.env.PR_NUMBER}/${name}`;
    };
    const thumbnail = (item, label) => {
      const url = html(image(item));
      return `<a href="${url}"><img src="${url}" alt="${label}" width="360"></a>`;
    };
    const counts = { passed: 0, changed: 0, flaky: 0, failed: (manifest.errors || []).length, skipped: 0 };
    const rows = (manifest.errors || []).map((error) => row('Capture setup', `<strong>Failed:</strong> ${html(error)}`, '—'));
    for (const test of manifest.tests) {
      if (test.status === 'passed') { counts[test.flaky ? 'flaky' : 'passed']++; continue; }
      if (test.status === 'skipped') { counts.skipped++; continue; }
      const actuals = test.images.filter((item) => item.name.endsWith('-actual.png'));
      if (!actuals.length) {
        counts.failed++;
        rows.push(row(test.name, '<strong>Capture failed</strong> — see CI report', '—'));
        continue;
      }
      const changes = actuals.filter((item) => !manifest.added.some((added) =>
        added.name === `${item.name.slice(0, -'-actual.png'.length)}-${project}-linux.png`));
      if (changes.length) counts.changed++;
      for (const actual of changes) {
        const stem = actual.name.slice(0, -'-actual.png'.length);
        const expected = test.images.find((item) => item.name === `${stem}-expected.png`);
        const diff = test.images.find((item) => item.name === `${stem}-diff.png`);
        rows.push(row(stem, expected ? thumbnail(expected, 'Before') : '<em>Baseline unavailable</em>', thumbnail(actual, 'After')));
        if (diff) details.push(`**${escape(stem)} (${project})**\n\n![Pixel diff](${image(diff)})`);
      }
    }
    for (const added of manifest.added) rows.push(row(added.name, '<em>Added</em>', thumbnail(added, 'After')));
    lines.push(`**${project}:** ${counts.passed} passed · ${counts.changed} changed · ${manifest.added.length} added screenshots · ${counts.flaky} flaky · ${counts.failed} failed captures · ${counts.skipped} skipped. Run status: **${escape(manifest.status)}**.`, '');
    if (rows.length) lines.push('<table>', '<thead><tr><th width="50%">Before</th><th width="50%">After</th></tr></thead>', '<tbody>', ...rows, '</tbody>', '</table>', '');
  }
  if (details.length) lines.push('<details>', '<summary>Pixel diffs</summary>', '', ...details.flatMap((detail) => [detail, '']), '</details>', '');
  lines.push('<details>', '<summary>Full reports and interpretation</summary>', '', `[Download the separate mobile and desktop Playwright reports from this CI run](${runUrl}).`, '', 'Changed counts are tests with comparison images. Added counts are newly generated screenshots. Flaky means an earlier attempt failed but the final attempt passed; its failed images are omitted. Failed captures and unavailable evidence do not establish that screenshots match.', '', '</details>');
  return lines.join('\n');
}
module.exports = { render };
if (require.main === module) {
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'visual-section.md'), render(process.env.CANDIDATES, process.env.VISUAL_DEST, {
    repository: process.env.GITHUB_REPOSITORY, sha: process.env.HEAD_SHA, runUrl: process.env.VISUAL_RUN_URL,
  }));
}

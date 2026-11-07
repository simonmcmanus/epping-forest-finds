const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { render } = require('../.github/scripts/render-visual-section.cjs');
const Reporter = require('../.github/scripts/visual-reporter.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const options = { repository: 'owner/repo', sha: 'tested-sha', runUrl: 'https://github.com/owner/repo/actions/runs/123' };
function manifest(root, project, tests, added = []) {
  const dir = path.join(root, `visual-evidence-${project}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const item of [...tests.flatMap((test) => test.images), ...added]) fs.writeFileSync(path.join(dir, item.file), item.file);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, project, status: 'failed', tests, added }));
}

test('review shows added screenshots, final differences and failed captures with device and revision context', (t) => {
  const root = fixture(t);
  manifest(root, 'mobile', [
    { name: 'search', status: 'failed', images: [
      { name: 'search-actual.png', file: 'actual.png' },
      { name: 'search-expected.png', file: 'before.png' },
      { name: 'search-diff.png', file: 'diff.png' },
    ] },
    { name: 'setup timed out', status: 'failed', images: [] },
    { name: 'map', status: 'passed', flaky: true, images: [] },
  ], [{ name: 'new-screen-mobile-linux.png', file: 'new.png' }]);
  manifest(root, 'desktop', [{ name: 'search', status: 'passed', images: [] }]);
  const output = path.join(root, 'published');
  const section = render(root, output, options);
  assert.match(section, /tested-sha/);
  assert.match(section, /1 changed · 1 added screenshots · 1 flaky · 1 failed captures/);
  assert.match(section, /new-screen-mobile-linux.png/);
  assert.match(section, /Capture failed/);
  assert.match(section, /Before/);
  assert.match(section, /<summary>Pixel diffs/);
  assert.match(section, /\*\*desktop:\*\* 1 passed/);
  assert.equal(fs.readdirSync(output).length, 4);
  assert.deepEqual(fs.readdirSync(output).map((file) => fs.readFileSync(path.join(output, file), 'utf8')).sort(), ['actual.png', 'before.png', 'diff.png', 'new.png']);
});

test('missing or invalid artifacts explicitly replace results with unavailable evidence', (t) => {
  const root = fixture(t);
  const section = render(root, path.join(root, 'published'), options);
  assert.match(section, /mobile: capture unavailable/);
  assert.match(section, /desktop: capture unavailable/);
  assert.doesNotMatch(section, /!\[/);
  manifest(root, 'mobile', [], [{ name: 'new screen', file: 'missing.png' }]);
  fs.unlinkSync(path.join(root, 'visual-evidence-mobile', 'missing.png'));
  assert.match(render(root, path.join(root, 'published-again'), options), /mobile: capture unavailable/);
});

test('untrusted artifact paths cannot read outside their evidence directory', (t) => {
  const root = fixture(t);
  const dir = path.join(root, 'visual-evidence-mobile');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, project: 'mobile', status: 'passed', tests: [], added: [{ name: 'unsafe', file: '../secret.png' }] }));
  assert.match(render(root, path.join(root, 'published'), options), /mobile: capture unavailable/);
});

test('reporter retains final retry outcome and images without collisions, and includes generated baselines', (t) => {
  const root = fixture(t);
  const originalCwd = process.cwd();
  const originalEnv = { VISUAL_PROJECT: process.env.VISUAL_PROJECT, VISUAL_EVIDENCE_DIR: process.env.VISUAL_EVIDENCE_DIR };
  t.after(() => {
    process.chdir(originalCwd);
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  execFileSync('git', ['init', '--quiet', root]);
  process.chdir(root);
  process.env.VISUAL_PROJECT = 'mobile';
  process.env.VISUAL_EVIDENCE_DIR = path.join(root, 'visual-evidence-mobile');
  fs.mkdirSync('test/e2e/__screenshots__', { recursive: true });
  fs.writeFileSync('test/e2e/__screenshots__/existing-mobile-linux.png', 'existing');
  execFileSync('git', ['add', '.']);
  const reporter = new Reporter();
  fs.writeFileSync('test/e2e/__screenshots__/added-mobile-linux.png', 'new image');
  const spec = (id) => ({ id, expectedStatus: 'passed', titlePath: () => ['root', id] });
  const attempt = (status, text, retry = 0) => {
    fs.writeFileSync('actual.png', text);
    return { status, retry, attachments: [{ name: 'screen-actual.png', path: path.join(root, 'actual.png') }] };
  };
  reporter.onTestEnd(spec('flaky'), attempt('failed', 'stale'));
  reporter.onTestEnd(spec('persistent'), attempt('failed', 'first attempt'));
  reporter.onTestEnd(spec('persistent'), attempt('failed', 'final attempt', 1));
  reporter.onTestEnd(spec('another'), attempt('failed', 'another screen'));
  reporter.onTestEnd(spec('flaky'), { status: 'passed', retry: 1, attachments: [] });
  reporter.onError({ message: 'web server exited unexpectedly' });
  reporter.onEnd({ status: 'failed' });
  const report = JSON.parse(fs.readFileSync(path.join(process.env.VISUAL_EVIDENCE_DIR, 'manifest.json')));
  assert.equal(report.tests.find((test) => test.name === 'flaky').status, 'passed');
  assert.equal(report.tests.find((test) => test.name === 'flaky').flaky, true);
  assert.deepEqual(report.added.map((item) => item.name), ['added-mobile-linux.png']);
  const published = path.join(root, 'published');
  const section = render(root, published, options);
  assert.match(section, /1 flaky/);
  assert.match(section, /web server exited unexpectedly/);
  assert.match(section, /1 failed captures/);
  const contents = fs.readdirSync(published).map((file) => fs.readFileSync(path.join(published, file), 'utf8')).sort();
  assert.deepEqual(contents, ['another screen', 'final attempt', 'new image']);
});

const { updateDescription } = require('../.github/scripts/update-visual-description.cjs');
function githubFixture() {
  const pr = { state: 'open', head: { sha: 'current', repo: { full_name: 'owner/repo' } }, body: 'Human summary\n\n<!-- preview-links:start -->\nhttps://preview.example/app?nuke=true\n<!-- preview-links:end -->\n<!-- visual-failures:start -->\nold screenshots\n<!-- visual-failures:end -->' };
  const updates = [];
  return { pr, updates, github: { rest: { pulls: {
    get: async () => ({ data: { ...pr } }),
    update: async (request) => { updates.push(request); pr.body = request.body; }, listFiles: () => {},
  } }, paginate: async () => [] } };
}
const context = { repo: { owner: 'owner', repo: 'repo' } };
test('a push during publication prevents stale screenshots from updating the description', async () => {
  const fixture = githubFixture();
  await updateDescription({ ...fixture, context, prNumber: 1, expectedSha: 'older-head', section: 'outdated render' });
  assert.equal(fixture.updates.length, 0);
  fixture.github.paginate = async () => { fixture.pr.head = { ...fixture.pr.head, sha: 'newer-head' }; return []; };
  await updateDescription({ ...fixture, context, prNumber: 1, expectedSha: 'current', section: 'outdated render' });
  assert.equal(fixture.updates.length, 0);
});
test('current evidence replaces old screenshots and preserves human text and the preview block verbatim', async () => {
  const fixture = githubFixture();
  const preview = fixture.pr.body.match(/<!-- preview-links:start -->[\s\S]*?<!-- preview-links:end -->/)[0];
  await updateDescription({ ...fixture, context, prNumber: 1, expectedSha: 'current', section: 'mobile: capture unavailable' });
  assert.equal(fixture.updates.length, 1);
  assert.ok(fixture.updates[0].body.includes(preview));
  assert.match(fixture.updates[0].body, /Human summary/);
  assert.match(fixture.updates[0].body, /capture unavailable/);
  assert.doesNotMatch(fixture.updates[0].body, /old screenshots/);
});

test('untrusted screenshot names and capture errors cannot notify GitHub users or teams', (t) => {
  const root = fixture(t);
  manifest(root, 'mobile', [
    { name: '@someone setup', status: 'failed', images: [] },
    { name: 'map', status: 'failed', images: [{ name: '@org/team-map-actual.png', file: 'map.png' }] },
  ], [{ name: '@another-user-screen.png', file: 'added.png' }]);
  const section = render(root, path.join(root, 'published'), options);
  assert.doesNotMatch(section, /@(someone|org|another-user)/);
  assert.match(section, /＠someone/);
  assert.match(section, /＠org\/team-map/);
  assert.match(section, /＠another-user/);
});

test('a preview update during file pagination is preserved while fresh evidence is still published', async () => {
  const fixture = githubFixture();
  fixture.github.paginate = async () => {
    fixture.pr.body = fixture.pr.body.replace('https://preview.example/app?nuke=true', 'https://new-preview.example/app?nuke=true') + '\nNew human notes';
    return [];
  };
  await updateDescription({ ...fixture, context, prNumber: 1, expectedSha: 'current', section: 'fresh comparisons' });
  assert.equal(fixture.updates.length, 1);
  assert.match(fixture.pr.body, /new-preview.example/);
  assert.match(fixture.pr.body, /New human notes/);
  assert.match(fixture.pr.body, /fresh comparisons/);
});

test('a publisher retries when another writer replaces its visual section', async () => {
  const fixture = githubFixture();
  const originalBody = fixture.pr.body;
  fixture.github.rest.pulls.update = async (request) => {
    fixture.updates.push(request);
    fixture.pr.body = fixture.updates.length === 1 ? originalBody + '\nNetlify ready' : request.body;
  };
  await updateDescription({ ...fixture, context, prNumber: 1, expectedSha: 'current', section: 'fresh comparisons' });
  assert.equal(fixture.updates.length, 2);
  assert.match(fixture.pr.body, /Netlify ready/);
  assert.match(fixture.pr.body, /fresh comparisons/);
});

test('persistent concurrent writers cause an explicit failure after three publication attempts', async () => {
  const fixture = githubFixture();
  fixture.github.rest.pulls.update = async (request) => { fixture.updates.push(request); };
  await assert.rejects(updateDescription({ ...fixture, context, prNumber: 1, expectedSha: 'current', section: 'fresh comparisons' }), /three concurrent PR body edits/);
  assert.equal(fixture.updates.length, 3);
});

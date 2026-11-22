const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'update-preview-links.yml'), 'utf8');
const lines = workflow.split('\n');
const start = lines.findIndex((line) => /^\s*script: \|\s*$/.test(line));
const indent = lines[start + 1].match(/^\s*/)[0].length;
const script = lines.slice(start + 1).map((line) => line.slice(indent)).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('github', 'context', 'core', script);

const PREVIEW = 'https://deploy-preview-1--epping-forest.netlify.app';
const START = '<!-- preview-links:start -->';
const END = '<!-- preview-links:end -->';
const block = (body) => body.slice(body.indexOf(START), body.indexOf(END) + END.length);

function harness({ statuses, name = 'The Plough', payload, latestBody }) {
  const updates = [];
  const index = { entries: [{ key: 'pubs', slug: 'the-plough', id: 'osm-1', name }] };
  const github = {
    rest: {
      repos: {
        listPullRequestsAssociatedWithCommit: async () => ({ data: [] }),
        listCommitStatusesForRef: async () => ({ data: statuses }),
        getContent: async () => ({ data: { content: Buffer.from(JSON.stringify(index)).toString('base64') } }),
      },
      pulls: {
        get: async () => ({ data: { ...payload.pull_request, body: latestBody === undefined ? payload.pull_request.body : latestBody } }),
        listFiles: async () => ({ data: [] }), update: async (args) => { updates.push(args); return {}; } },
    },
    paginate: async () => [],
  };
  const context = { repo: { owner: 'o', repo: 'r' }, eventName: 'pull_request', payload };
  const core = { warning() {}, notice() {}, info() {} };
  return { github, context, core, updates };
}
const success = [
  { context: 'deploy/netlify', state: 'pending', target_url: 'https://pending.example/' },
  { context: 'deploy/netlify', state: 'success', target_url: `${PREVIEW}/` },
];
const prPayload = (body) => ({ pull_request: { number: 7, state: 'open', head: { sha: 'abc' }, body } });
const mangled = `Intro text\n\n${START}\n\`\`\`&lt;img src="x"&gt;\`\`\`\n${END}\n\nTail text\n`;

test('editing a PR body repairs a mangled preview-links block', async () => {
  const h = harness({ statuses: success, payload: prPayload(mangled) });
  await run(h.github, h.context, h.core);
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].pull_number, 7);
  const next = h.updates[0].body;
  assert.ok(next.includes(`<img src="${PREVIEW}/data/icons/home.png"`));
  assert.ok(!block(next).includes('`'));
  assert.ok(!block(next).includes('&lt;'));
  assert.equal(next.slice(0, next.indexOf(START)), mangled.slice(0, mangled.indexOf(START)));
  assert.equal(next.slice(next.indexOf(END) + END.length), mangled.slice(mangled.indexOf(END) + END.length));
});

test('a body whose preview-links block is current is left alone', async () => {
  const first = harness({ statuses: success, payload: prPayload(mangled) });
  await run(first.github, first.context, first.core);
  const h = harness({ statuses: success, payload: prPayload(first.updates[0].body) });
  await run(h.github, h.context, h.core);
  assert.equal(h.updates.length, 0);
});

test('a PR edit without a successful Netlify deploy does not write the body', async () => {
  const h = harness({ statuses: [{ context: 'deploy/netlify', state: 'pending', target_url: 'https://x.example/' }, { context: 'ci', state: 'success', target_url: 'https://y.example/' }], payload: prPayload(mangled) });
  await run(h.github, h.context, h.core);
  assert.equal(h.updates.length, 0);
});

test('business names containing replacement patterns appear literally', async () => {
  const h = harness({ statuses: success, name: "Tom $& Jerry $1 $'", payload: prPayload(mangled) });
  await run(h.github, h.context, h.core);
  assert.ok(block(h.updates[0].body).includes("<sub>Tom $& Jerry $1 $'</sub>"));
});

test('a queued run keeps hand edits made after its event by reading the latest PR body', async () => {
  const note = 'Hand-added note from a later edit';
  const latest = `Intro text\n\n${note}\n\n${START}\n\`\`\`&lt;img src="x"&gt;\`\`\`\n${END}\n\nTail text\n`;
  const h = harness({ statuses: success, payload: prPayload('Intro text\n'), latestBody: latest });
  await run(h.github, h.context, h.core);
  assert.equal(h.updates.length, 1);
  const next = h.updates[0].body;
  assert.ok(next.includes(note));
  assert.ok(next.includes(`<img src="${PREVIEW}/data/icons/home.png"`));
  assert.ok(!block(next).includes('&lt;'));
});

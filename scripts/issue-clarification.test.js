"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { inputHash, scopeHash, planClarification, prepare, publish } = require("./issue-clarification.js");

const user = { login: "walker", type: "User" };
const issue = () => ({ number: 17, title: "Missing event", body: "Please add the walk", state: "open", labels: [] });
const event = () => ({ sender: user, action: "opened" });
const comment = (id, body, author = user) => ({ id, body, user: author });
const ready = () => ({ status: "ready", classification: "bug", summary: "Confirmed against the data.", issue_body: "## Summary\nA self-contained issue", automatic_data_kind: "none", data_evidence: "", source_url: "", source_evidence: "" });
function fakeGitHub(value = issue(), comments = []) {
  const calls = [];
  const github = { paginate: async () => comments, rest: { issues: {
    get: async () => ({ data: value }), listComments() {},
    update: async args => calls.push(["update", args]), updateComment: async args => calls.push(["updateComment", args]),
    createComment: async args => { calls.push(["createComment", args]); return { data: { id: 42 } }; }, addLabels: async args => calls.push(["addLabels", args]),
  }, actions: { createWorkflowDispatch: async args => calls.push(["dispatch", args]) } } };
  const context = { repo: { owner: "owner", repo: "site" }, issue: { number: 17 }, payload: { repository: { default_branch: "main" } } };
  return { github, context, calls };
}

test("bot comments, closed issues, PRs and place checks do not invoke clarification", () => {
  assert.equal(planClarification({ sender: { login: "some[bot]", type: "Bot" } }, issue(), []).run, false);
  assert.equal(planClarification({ sender: user, comment: comment(1, "service", { login: "service[bot]", type: "Bot" }) }, issue(), []).run, false);
  for (const changes of [{ state: "closed" }, { pull_request: {} }, { labels: [{ name: "place-check" }] }]) {
    assert.equal(planClarification(event(), { ...issue(), ...changes }, []).run, false);
  }
});

test("unchanged human requirements skip model even if bot chatter changed", () => {
  const value = issue();
  const summary = comment(2, `Ready\n<!-- issue-clarification:${JSON.stringify({ input_hash: inputHash(value, []), status: "needs_information" })} -->`, { login: "github-actions[bot]", type: "Bot" });
  assert.equal(planClarification(event(), value, [summary, comment(3, "build finished", { login: "ci[bot]", type: "Bot" })]).run, false);
});

test("ready issues need a scope edit or explicit clarify request", () => {
  const value = { ...issue(), labels: [{ name: "claude" }] };
  assert.equal(planClarification({ sender: user, comment: comment(3, "Thanks!") }, value, []).run, false);
  assert.equal(planClarification({ sender: user, action: "edited", changes: { body: { from: "old" } } }, value, []).run, true);
  assert.equal(planClarification({ sender: user, comment: comment(3, "/clarify new scope") }, value, []).run, true);
});

test("summary markers in human text cannot spoof model input deduplication", () => {
  const value = issue();
  const forged = comment(2, `<!-- issue-clarification:${JSON.stringify({ input_hash: inputHash(value, []), status: "ready" })} -->`);
  assert.equal(planClarification(event(), value, [forged]).run, true);
});

test("publisher rejects a changed issue before mutation", async () => {
  const fake = fakeGitHub({ ...issue(), body: "New scope" });
  const outcome = await publish({ ...fake, result: ready(), expectedHash: inputHash(issue(), []) });
  assert.equal(outcome.published, false);
  assert.equal(fake.calls.length, 0);
});

test("ready publication updates one bot summary and records the rewritten input hash", async () => {
  const old = comment(9, "Old\n<!-- issue-clarification:{} -->", { login: "github-actions[bot]", type: "Bot" });
  const fake = fakeGitHub(issue(), [old]);
  const result = ready();
  await publish({ ...fake, result, expectedHash: inputHash(issue(), [old]) });
  assert.deepEqual(fake.calls.map(x => x[0]), ["update", "updateComment"]);
  assert.equal(fake.calls[1][1].comment_id, 9);
  assert.ok(fake.calls[1][1].body.includes(inputHash({ ...issue(), body: result.issue_body }, [old])));
  assert.ok(fake.calls[1][1].body.includes(scopeHash({ ...issue(), body: result.issue_body })));
});

test("confirmed sourced data labels then explicitly dispatches implementation", async () => {
  const fake = fakeGitHub();
  const result = { ...ready(), automatic_data_kind: "event", data_evidence: "data/forest-events.json has no entry", source_url: "https://example.org/walk", source_evidence: "Venue and 12 November date confirmed" };
  const outcome = await publish({ ...fake, result, expectedHash: inputHash(issue(), []) });
  assert.equal(outcome.dispatched, true);
  assert.deepEqual(fake.calls.slice(-3).map(x => x[0]), ["addLabels", "dispatch", "updateComment"]);
  assert.deepEqual(fake.calls.find(x => x[0] === "dispatch")[1].inputs, { issue_number: "17" });
});

test("feature or unverified data cannot cause automatic handoff", async () => {
  const fake = fakeGitHub();
  await publish({ ...fake, result: ready(), expectedHash: inputHash(issue(), []) });
  assert.ok(!fake.calls.some(x => x[0] === "dispatch"));
  await assert.rejects(publish({ ...fake, result: { ...ready(), automatic_data_kind: "event", data_evidence: "not listed", source_url: "", source_evidence: "" }, expectedHash: inputHash(issue(), []) }), /source URL/);
});

test("editing a labelled issue does not dispatch another implementation", async () => {
  const value = { ...issue(), labels: [{ name: "claude" }] };
  const fake = fakeGitHub(value);
  const outcome = await publish({ ...fake, result: { ...ready(), automatic_data_kind: "existing_place", data_evidence: "Mapped record confirmed" }, expectedHash: inputHash(value, []) });
  assert.equal(outcome.dispatched, false);
});

const { prepareImplementation } = require("./issue-clarification.js");
function implementationFake(value, pulls = []) {
  const fake = fakeGitHub(value);
  fake.context.payload.inputs = { issue_number: String(value.number) };
  fake.github.rest.pulls = { list: async () => ({ data: pulls }) };
  fake.github.rest.git = { getRef: async () => { const error = new Error("Missing"); error.status = 404; throw error; } };
  fake.outputs = {};
  fake.core = { setOutput: (key, result) => { fake.outputs[key] = result; }, info() {} };
  return fake;
}

test("implementation dispatch rejects arbitrary issue input and unlabeled issues", async () => {
  const fake = implementationFake(issue());
  fake.context.payload.inputs.issue_number = "1; echo unsafe";
  await assert.rejects(prepareImplementation({ ...fake, outputPath: "/tmp/unused-implementation.json" }), /positive issue number/);
  fake.context.payload.inputs.issue_number = "17";
  assert.equal((await prepareImplementation({ ...fake, outputPath: "/tmp/unused-implementation.json" })).run, false);
});

test("implementation dispatch reuses a deterministic branch and stops for existing PR", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "issue-implementation-"));
  try {
    const value = { ...issue(), labels: [{ name: "claude" }] };
    const fake = implementationFake(value);
    const outputPath = path.join(folder, "issue.json");
    const result = await prepareImplementation({ ...fake, outputPath });
    assert.equal(result.branch, "claude/issue-17");
    assert.equal(JSON.parse(fs.readFileSync(outputPath)).number, 17);
    const existing = implementationFake(value, [{ html_url: "https://github.com/owner/site/pull/42" }]);
    assert.equal((await prepareImplementation({ ...existing, outputPath })).run, false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("failed label or dispatch leaves a recoverable handoff that preflight retries without a model", async () => {
  for (const failure of ["label", "dispatch"]) {
    const value = issue();
    const comments = [];
    const fake = fakeGitHub(value, comments);
    fake.context.payload.sender = user;
    fake.context.payload.action = "edited";
    fake.core = { setOutput() {}, info() {} };
    fake.github.rest.issues.createComment = async args => {
      fake.calls.push(["createComment", args]);
      const summary = comment(42, args.body, { login: "github-actions[bot]", type: "Bot" });
      comments.push(summary);
      return { data: summary };
    };
    fake.github.rest.issues.update = async args => { value.body = args.body; };
    fake.github.rest.issues.addLabels = async () => {
      if (failure === "label") throw new Error("label unavailable");
      value.labels = [{ name: "claude" }];
    };
    fake.github.rest.actions.createWorkflowDispatch = async () => { throw new Error("dispatch unavailable"); };
    const result = { ...ready(), automatic_data_kind: "existing_place", data_evidence: "Mapped record confirmed" };
    await assert.rejects(publish({ ...fake, result, expectedHash: inputHash(issue(), []) }), /unavailable/);
    assert.ok(comments[0].body.includes('"handoff":"pending"'));
    let dispatched = 0;
    fake.github.rest.issues.addLabels = async () => { value.labels = [{ name: "claude" }]; };
    fake.github.rest.actions.createWorkflowDispatch = async () => { dispatched++; };
    fake.github.rest.issues.updateComment = async args => { comments[0].body = args.body; };
    const recovered = await prepare({ ...fake, outputPath: "/tmp/unused-clarification.json" });
    assert.equal(recovered.run, false);
    assert.equal(recovered.recoveredHandoff, true);
    assert.equal(dispatched, 1);
    assert.ok(comments[0].body.includes('"handoff":"dispatched"'));
    assert.equal((await prepare({ ...fake, outputPath: "/tmp/unused-clarification.json" })).run, false);
    assert.equal(dispatched, 1);
  }
});

test("pending dispatch survives /clarify and retries only after the current data change is ready", async () => {
  const value = issue();
  const comments = [];
  const fake = fakeGitHub(value, comments);
  fake.context.payload.sender = user;
  fake.core = { setOutput() {}, info() {} };
  fake.github.rest.issues.createComment = async args => {
    const summary = comment(42, args.body, { login: "github-actions[bot]", type: "Bot" });
    comments.push(summary);
    return { data: summary };
  };
  fake.github.rest.issues.update = async args => { value.body = args.body; };
  fake.github.rest.issues.updateComment = async args => { comments[0].body = args.body; };
  fake.github.rest.issues.addLabels = async () => { value.labels = [{ name: "claude" }]; };
  fake.github.rest.actions.createWorkflowDispatch = async () => { throw new Error("dispatch unavailable"); };
  const dataReady = { ...ready(), automatic_data_kind: "existing_place", data_evidence: "Mapped record confirmed" };
  await assert.rejects(publish({ ...fake, result: dataReady, expectedHash: inputHash(value, comments) }), /dispatch unavailable/);
  const request = comment(43, "/clarify the address as well");
  comments.push(request);
  fake.context.payload.comment = request;
  assert.equal(planClarification(fake.context.payload, value, comments).run, true);

  let dispatches = 0;
  fake.github.rest.actions.createWorkflowDispatch = async () => { dispatches++; };
  await publish({ ...fake, result: { ...ready(), status: "needs_information", issue_body: "", summary: "Which address?" }, expectedHash: inputHash(value, comments) });
  assert.ok(comments[0].body.includes('"handoff":"pending"'));
  assert.equal(dispatches, 0);
  assert.equal((await prepare({ ...fake, outputPath: "/tmp/unused-clarification.json" })).recoveredHandoff, undefined);

  const answer = comment(44, "The verified address in the dataset is correct.");
  comments.push(answer);
  fake.context.payload.comment = answer;
  assert.equal(planClarification(fake.context.payload, value, comments).run, true);
  const outcome = await publish({ ...fake, result: dataReady, expectedHash: inputHash(value, comments) });
  assert.equal(outcome.dispatched, true);
  assert.equal(dispatches, 1);
  assert.ok(comments[0].body.includes('"handoff":"dispatched"'));

  comments.push(comment(45, "/clarify one more detail"));
  await publish({ ...fake, result: dataReady, expectedHash: inputHash(value, comments) });
  assert.equal(dispatches, 1, "a durable dispatch acknowledgment prevents duplicate implementation");
});

test("a later thanks comment cannot hide changed ready-issue scope", () => {
  const original = issue();
  const summary = comment(20, `Ready\n<!-- issue-clarification:${JSON.stringify({ status: "ready", input_hash: inputHash(original, []), scope_hash: scopeHash(original) })} -->`, { login: "github-actions[bot]", type: "Bot" });
  const thanks = comment(21, "Thanks!");
  const latestEvent = { sender: user, action: "created", comment: thanks };
  const comments = [summary, thanks];
  assert.equal(planClarification(latestEvent, { ...original, body: "Scope changed while a run was queued" }, comments).run, true);
  assert.equal(planClarification(latestEvent, { ...original, title: "Changed title scope" }, comments).run, true);
  assert.equal(planClarification(latestEvent, original, comments).run, false);
});

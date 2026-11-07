"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const MARKER = "<!-- issue-clarification:";
const LABEL = "claude";

function isHuman(user) {
  return user?.type === "User" && !/\[bot\]$|^claude$/i.test(user.login || "");
}

function previousSummary(comments) {
  return [...comments].reverse().find(comment =>
    comment.user?.login === "github-actions[bot]" && comment.body?.includes(MARKER));
}

function metadata(summary) {
  const text = summary?.body?.match(/<!-- issue-clarification:(\{[^\n]*\}) -->/);
  try { return text ? JSON.parse(text[1]) : {}; } catch { return {}; }
}

function humanInputs(issue, comments) {
  return {
    number: issue.number,
    title: issue.title || "",
    body: issue.body || "",
    comments: comments.filter(comment => isHuman(comment.user)).map(comment => ({
      id: comment.id, author: comment.user.login, body: comment.body || "",
    })),
  };
}

function scopeHash(issue) {
  return createHash("sha256").update(JSON.stringify({ title: issue.title || "", body: issue.body || "" })).digest("hex");
}

function inputHash(issue, comments) {
  return createHash("sha256").update(JSON.stringify(humanInputs(issue, comments))).digest("hex");
}

function planClarification(event, issue, comments) {
  if (!issue || issue.pull_request || issue.state !== "open") return { run: false, reason: "Not an open issue" };
  if (!isHuman(event.sender)) return { run: false, reason: "Bot or service event" };
  if (event.comment && !isHuman(event.comment.user)) return { run: false, reason: "Bot or service comment" };
  if ((issue.labels || []).some(label => (label.name || label) === "place-check")) return { run: false, reason: "Structured place check" };
  const summary = previousSummary(comments);
  const prior = metadata(summary);
  const hash = inputHash(issue, comments);
  if (hash === prior.input_hash) return { run: false, reason: "Human inputs unchanged" };
  const ready = prior.status === "ready" ||
    (prior.status !== "needs_information" && (issue.labels || []).some(label => (label.name || label) === LABEL));
  // Compare persisted scope, not just the latest event: a later acknowledgement
  // can replace the queued edit event while the issue itself still has new scope.
  const changedScope = typeof prior.scope_hash === "string" && prior.scope_hash !== scopeHash(issue);
  const editedScope = event.action === "edited" && !event.comment && (event.changes?.body || event.changes?.title);
  const explicitlyRequested = event.comment && /^\/clarify(?:\s|$)/i.test(event.comment.body || "");
  if (ready && !changedScope && !editedScope && !explicitlyRequested) return { run: false, reason: "Already ready; edit scope or use /clarify" };
  const inputs = humanInputs(issue, comments);
  return {
    run: true, input_hash: hash, summary_id: summary?.id,
    packet: {
      issue: { number: issue.number, title: inputs.title.slice(0, 1000), body: inputs.body.slice(0, 24000) },
      // The prior maintained summary carries older answers; bot chatter is omitted.
      recent_human_comments: inputs.comments.slice(-12).map(comment => ({ ...comment, body: comment.body.slice(0, 4000) })),
      prior_summary: summary?.body?.split(MARKER)[0].slice(0, 6000) || "",
      context_limits: "At most 12 recent human comments are included; do not claim omitted history was reviewed.",
    },
  };
}

function validateResult(result) {
  if (!result || !["needs_information", "ready"].includes(result.status)) throw new Error("Invalid clarification status");
  if (!["bug", "feature"].includes(result.classification)) throw new Error("Invalid issue classification");
  if (typeof result.summary !== "string" || !result.summary.trim() || result.summary.length > 10000 || result.summary.includes(MARKER)) throw new Error("Invalid clarification summary");
  if (typeof result.issue_body !== "string" || result.issue_body.length > 30000) throw new Error("Invalid clarified issue body");
  if (result.status === "ready" && !result.issue_body.trim()) throw new Error("A ready issue must have a clarified body");
  if (!["none", "existing_place", "event", "closure", "notice"].includes(result.automatic_data_kind)) throw new Error("Invalid automatic data kind");
  if (result.automatic_data_kind !== "none") {
    if (result.status !== "ready" || typeof result.data_evidence !== "string" || !result.data_evidence.trim()) throw new Error("Automatic data changes need verified data evidence");
    if (result.automatic_data_kind !== "existing_place") {
      let url;
      try { url = new URL(result.source_url); } catch { throw new Error("A new data entry needs a cited source URL"); }
      if (!["http:", "https:"].includes(url.protocol) || typeof result.source_evidence !== "string" || !result.source_evidence.trim()) throw new Error("A new data entry needs fetched source evidence");
    }
  }
  return result;
}

async function loadInputs(github, context) {
  const args = { ...context.repo, issue_number: context.issue.number };
  const issue = (await github.rest.issues.get(args)).data;
  const comments = await github.paginate(github.rest.issues.listComments, { ...args, per_page: 100 });
  return { issue, comments };
}

async function completeHandoff({ github, context, issue, summary }) {
  const args = { ...context.repo, issue_number: issue.number };
  const prior = metadata(summary);
  await github.rest.issues.addLabels({ ...args, labels: [LABEL] });
  // GITHUB_TOKEN label events cannot start another workflow. Dispatch explicitly.
  // If dispatch succeeds but marking it fails, a retry may dispatch again. The
  // implementation workflow serializes by issue and skips an existing PR.
  await github.rest.actions.createWorkflowDispatch({
    ...context.repo, workflow_id: "claude-issue-agent.yml", ref: context.payload.repository.default_branch,
    inputs: { issue_number: String(issue.number) },
  });
  const body = summary.body.split(MARKER)[0] + MARKER + JSON.stringify({ ...prior, handoff: "dispatched" }) + " -->";
  await github.rest.issues.updateComment({ ...context.repo, comment_id: summary.id, body });
}

async function prepare({ github, context, core, outputPath }) {
  const { issue, comments } = await loadInputs(github, context);
  const plan = planClarification(context.payload, issue, comments);
  const summary = previousSummary(comments);
  const prior = metadata(summary);
  const eligible = issue.state === "open" && !issue.pull_request && isHuman(context.payload.sender) &&
    !(issue.labels || []).some(label => (label.name || label) === "place-check");
  if (eligible && prior.status === "ready" && prior.handoff === "pending" &&
      prior.handoff_eligible === true && prior.input_hash === inputHash(issue, comments)) {
    await completeHandoff({ github, context, issue, summary });
    core.setOutput("run", "false");
    core.info("Retried a pending implementation handoff without another model call");
    return { run: false, recoveredHandoff: true };
  }
  core.setOutput("run", String(plan.run));
  core.info(plan.reason || "Human requirements changed");
  if (plan.run) {
    fs.writeFileSync(outputPath, JSON.stringify(plan.packet));
    core.setOutput("input_hash", plan.input_hash);
  }
  return plan;
}

async function publish({ github, context, result, expectedHash }) {
  validateResult(result);
  const { issue, comments } = await loadInputs(github, context);
  if (issue.state !== "open" || issue.pull_request || inputHash(issue, comments) !== expectedHash) return { published: false, reason: "Issue changed during clarification" };
  if ((issue.labels || []).some(label => (label.name || label) === "place-check")) return { published: false, reason: "Now a place check" };
  const args = { ...context.repo, issue_number: issue.number };
  const alreadyLabeled = (issue.labels || []).some(label => (label.name || label) === LABEL);
  const nextIssue = { ...issue };
  if (result.status === "ready" && result.issue_body !== issue.body) {
    await github.rest.issues.update({ ...args, body: result.issue_body });
    nextIssue.body = result.issue_body;
  }
  const prior = previousSummary(comments);
  const priorHandoff = metadata(prior).handoff;
  const eligibleHandoff = result.status === "ready" && result.automatic_data_kind !== "none";
  // A label is not an acknowledgment: label creation may have succeeded before
  // dispatch failed. Preserve that pending state through scope reclarification,
  // but only retry after the current requirements are again verified ready data.
  const needsHandoff = eligibleHandoff && priorHandoff !== "dispatched" &&
    (!alreadyLabeled || priorHandoff === "pending");
  const handoff = needsHandoff ? "pending" : ["pending", "dispatched"].includes(priorHandoff) ? priorHandoff : "none";
  const body = `${result.summary}\n\n${MARKER}${JSON.stringify({ version: 1, input_hash: inputHash(nextIssue, comments), scope_hash: scopeHash(nextIssue), status: result.status, handoff, handoff_eligible: eligibleHandoff })} -->`;
  let summary;
  if (prior) {
    await github.rest.issues.updateComment({ ...context.repo, comment_id: prior.id, body });
    summary = { ...prior, body };
  } else {
    const response = await github.rest.issues.createComment({ ...args, body });
    summary = { ...response.data, body };
  }
  let dispatched = false;
  if (needsHandoff) {
    await completeHandoff({ github, context, issue: nextIssue, summary });
    dispatched = true;
  }
  return { published: true, dispatched };
}

module.exports = { inputHash, scopeHash, planClarification, validateResult, prepare, publish };

async function prepareImplementation({ github, context, core, outputPath }) {
  const supplied = context.payload.issue?.number ?? context.payload.inputs?.issue_number;
  if (!/^[1-9]\d*$/.test(String(supplied))) throw new Error("A positive issue number is required");
  const issueNumber = Number(supplied);
  if (!Number.isSafeInteger(issueNumber)) throw new Error("Invalid issue number");
  const issue = (await github.rest.issues.get({ ...context.repo, issue_number: issueNumber })).data;
  if (issue.pull_request || issue.state !== "open" || !(issue.labels || []).some(label => (label.name || label) === LABEL)) {
    core.setOutput("run", "false");
    core.info("Implementation requires an open issue labelled claude");
    return { run: false };
  }
  const branch = `claude/issue-${issueNumber}`;
  const pulls = (await github.rest.pulls.list({ ...context.repo, head: `${context.repo.owner}:${branch}`, state: "all", per_page: 100 })).data;
  if (pulls.length) {
    core.setOutput("run", "false");
    core.info(`Implementation already has a PR: ${pulls[0].html_url}`);
    return { run: false };
  }
  let branchExists = false;
  try {
    await github.rest.git.getRef({ ...context.repo, ref: `heads/${branch}` });
    branchExists = true;
  } catch (error) { if (error.status !== 404) throw error; }
  fs.writeFileSync(outputPath, JSON.stringify({ number: issueNumber, title: issue.title, body: issue.body || "", branch }));
  core.setOutput("run", "true");
  core.setOutput("issue_number", String(issueNumber));
  core.setOutput("branch", branch);
  core.setOutput("branch_exists", String(branchExists));
  return { run: true, branch, branchExists };
}

module.exports.prepareImplementation = prepareImplementation;

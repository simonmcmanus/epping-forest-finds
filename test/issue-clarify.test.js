const test = require("node:test");
const assert = require("node:assert/strict");

const {
  splitPreviousQuestions,
  normalizeOptionalString,
  includesSameQuestionNumbers,
  buildAnnotatedCommentBody,
} = require("../.github/scripts/issue-clarify.js");

test("splitPreviousQuestions strips suggested description block", () => {
  const body = [
    "I need a few quick clarifications:",
    "1. First question?",
    "",
    "---",
    "",
    "**Suggested description:**",
    "",
    "Suggested text",
  ].join("\n");

  assert.equal(
    splitPreviousQuestions(body),
    "I need a few quick clarifications:\n1. First question?"
  );
});

test("normalizeOptionalString rejects non-strings", () => {
  assert.equal(normalizeOptionalString({ text: "nope" }), null);
  assert.equal(normalizeOptionalString(["nope"]), null);
  assert.equal(normalizeOptionalString("  "), null);
  assert.equal(normalizeOptionalString("ok"), "ok");
});

test("includesSameQuestionNumbers requires all original question numbers", () => {
  const previous = "1. One?\n2. Two?\n3. Three?";
  assert.equal(includesSameQuestionNumbers(previous, "🟢 1. One?\n🟡 2. Two?\n🔴 3. Three?"), true);
  assert.equal(includesSameQuestionNumbers(previous, "🟢 1. One?\n🟡 2. Two?"), false);
});

test("buildAnnotatedCommentBody preserves questions and appends valid suggestion", () => {
  const previous = "1. One?\n2. Two?";
  const result = {
    annotated: "🟢 1. One?\n> understood one\n🔴 2. Two?",
    suggested_description: "## Bug report\n\nFilled template content",
  };

  const commentBody = buildAnnotatedCommentBody(result, previous);
  assert.match(commentBody, /🟢 1\. One\?/);
  assert.match(commentBody, /\*\*Suggested description:\*\*/);
  assert.match(commentBody, /## Bug report/);
});

test("buildAnnotatedCommentBody rejects malformed model payloads", () => {
  const previous = "1. One?\n2. Two?";
  assert.equal(buildAnnotatedCommentBody({ annotated: { bad: true } }, previous), null);
  assert.equal(buildAnnotatedCommentBody({ annotated: "1. One?" }, previous), null);
  assert.equal(buildAnnotatedCommentBody({ annotated: "1. One?\n3. Three?" }, previous), null);
});

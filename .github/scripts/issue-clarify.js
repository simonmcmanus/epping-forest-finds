const fs = require("fs");
const https = require("https");
const { execFileSync } = require("child_process");

const issueNumber = process.env.ISSUE_NUMBER;
const issueTitle = process.env.ISSUE_TITLE || "";
const issueBody = process.env.ISSUE_BODY || "(No body provided)";
const eventAction = process.env.EVENT_ACTION || "opened";
const suggestedDescSeparator = "\n\n---\n\n**Suggested description:**";
// A numbered question line can be plain (`1. Question`) or emoji-prefixed (`🟢 1. Question`).
const numberedQuestionLineRegex = /^\s*(?:[^\d\n]+\s+)?(\d+)\.\s+/gm;

const readFile = (path) => {
  try { return fs.readFileSync(path, "utf8"); } catch { return ""; }
};
const clip = (str, max) => str.length > max ? str.slice(0, max) + "\n...(clipped)" : str;

const projectGuidelines = clip(readFile("CLAUDE.md"), 2000);
const specMain = clip(readFile("spec/spec.md"), 3000);
const specRendering = clip(readFile("spec/spec-data-rendering.md"), 2000);
const glossary = clip(readFile("spec/glossary.md"), 1000);

const preamble = [
  "You are a developer assistant for the Epping Forest Finds project",
  "-- a vanilla JS canvas-based map app for exploring Epping Forest,",
  "with no build step and a mobile-first performance focus.",
  "",
  "## Project guidelines",
  projectGuidelines,
  "",
  "## Spec overview",
  specMain,
  "",
  "## Rendering spec",
  specRendering,
  "",
  "## Glossary",
  glossary,
  "",
  "---",
  "",
  "Title: " + issueTitle,
  "",
  "Body:",
  issueBody,
  "",
  "---",
].join("\n");

function callModel(payload, cb) {
  const body = JSON.stringify(payload);
  const options = {
    hostname: "models.inference.ai.azure.com",
    path: "/chat/completions",
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.GITHUB_TOKEN,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    },
  };
  const req = https.request(options, (res) => {
    let data = "";
    res.on("data", (chunk) => { data += chunk; });
    res.on("end", () => {
      let parsed;
      try { parsed = JSON.parse(data); } catch {
        console.error("Failed to parse response:", data);
        process.exit(1);
      }
      const content = parsed?.choices?.[0]?.message?.content;
      if (!content) {
        console.error("Unexpected API response:", data);
        process.exit(1);
      }
      cb(content);
    });
  });
  req.on("error", (err) => { console.error(err); process.exit(1); });
  req.write(body);
  req.end();
}

function postComment(text) {
  execFileSync("gh", ["issue", "comment", issueNumber, "--body", text], {
    stdio: "inherit",
    env: { ...process.env },
  });
}

function hasNumberedQuestions(text) {
  return new RegExp(numberedQuestionLineRegex.source, "m").test(String(text || ""));
}

function splitPreviousQuestions(commentBody) {
  const bodyText = String(commentBody || "");
  return bodyText.includes(suggestedDescSeparator)
    ? bodyText.slice(0, bodyText.indexOf(suggestedDescSeparator))
    : bodyText;
}

function normalizeOptionalString(value) {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() ? value : null;
  return null;
}

function normalizeModelResult(result) {
  return {
    annotated: normalizeOptionalString(result?.annotated),
    newQuestions: normalizeOptionalString(result?.new_questions ?? result?.newQuestions),
    suggestedDescription: normalizeOptionalString(result?.suggested_description ?? result?.suggestedDescription),
  };
}

function includesSameQuestionNumbers(previousQuestions, annotated) {
  const getNumbers = (text) => {
    const matches = String(text || "").matchAll(numberedQuestionLineRegex);
    return [...matches].map(match => match[1]);
  };
  const previous = getNumbers(previousQuestions);
  const next = new Set(getNumbers(annotated));
  if (!previous.length) return false;
  return previous.every((number) => next.has(number));
}

function buildAnnotatedCommentBody(result, previousQuestions) {
  const { annotated, suggestedDescription } = normalizeModelResult(result);
  if (!annotated || !includesSameQuestionNumbers(previousQuestions, annotated)) {
    return null;
  }
  return suggestedDescription
    ? annotated + suggestedDescSeparator + "\n\n" + suggestedDescription
    : annotated;
}

function handleOpened() {
  const prompt = [
    preamble,
    "Your task: post 3-5 focused clarifying questions that will help a developer",
    "fully understand what needs to be implemented or fixed before writing any code.",
    "",
    "Guidelines:",
    "- Be specific to this project's architecture (canvas renderer, inspector panel,",
    "  data normalisation, nav/camera, tracker, etc.)",
    "- Surface ambiguities in scope, UX behaviour, data handling, or mobile performance",
    "- Skip anything already clearly stated in the issue",
    "- Format as a numbered list with a short friendly intro line",
    "- Keep tone collaborative, not interrogative",
  ].join("\n");

  callModel({ model: "gpt-4o-mini", max_tokens: 1024, messages: [{ role: "user", content: prompt }] }, postComment);
}

function handleEdited() {
  const repo = process.env.GITHUB_REPOSITORY;

  let allComments = [];
  try {
    const raw = execFileSync("gh", [
      "api", `repos/${repo}/issues/${issueNumber}/comments`,
    ], { env: { ...process.env } }).toString();
    allComments = JSON.parse(raw);
  } catch (e) {
    console.error("Failed to fetch comments:", e.message);
    process.exit(1);
  }

  const botComment = [...allComments].reverse().find(c => c.user.login === "github-actions[bot]");

  if (!botComment) {
    console.log("No previous bot comment found — running initial flow.");
    handleOpened();
    return;
  }

  console.log(`Found bot comment id=${botComment.id}`);

  const previousQuestions = splitPreviousQuestions(botComment.body);
  if (!hasNumberedQuestions(previousQuestions)) {
    console.log("Existing bot comment does not contain numbered questions — running initial flow.");
    handleOpened();
    return;
  }

  const humanReplies = allComments
    .filter(c => c.user.login !== "github-actions[bot]")
    .map(c => `[${c.user.login}]: ${c.body}`)
    .join("\n\n") || "(No replies yet)";

  const prompt = [
    preamble,
    "The issue has been updated or a comment was added. Below are the clarifying questions",
    "previously asked, followed by all human replies.",
    "",
    "## Previous questions",
    previousQuestions,
    "",
    "## Replies so far",
    humanReplies,
    "",
    "---",
    "",
    'Return a JSON object with exactly three fields: "annotated", "new_questions", and "suggested_description".',
    'Each field value must be either a string or null (never objects or arrays).',
    '- "annotated": a fully re-evaluated version of the previous questions comment.',
    '  The comment may already contain emojis and blockquote summaries from a prior pass —',
    '  treat those as stale and replace them entirely based on the current replies.',
    '  For each numbered question, output:',
    '    <emoji> <number>. <original question text>',
    '    > <one or two sentences summarising the current answer from the replies>',
    '  Emojis:',
    '  🟢 clearly and fully answered',
    '  🟡 partially answered or needs more detail',
    '  🔴 not yet answered — omit the blockquote line for these',
    '  Keep the intro line exactly as it was (strip any stale emoji/blockquote from it).',
    '  Keep every original numbered question with the same numbering and wording.',
    '- "new_questions": a numbered list (with a short friendly intro line) of any important',
    '  remaining questions not yet covered — or null if nothing important is missing.',
    '  Err strongly on the side of null.',
    '- "suggested_description": a rewritten version of the original issue body that folds in',
    '  all clarified information so the description is self-contained and unambiguous.',
    '  Preserve the original intent; add detail where replies have resolved ambiguity.',
    '  Keep the same issue template structure, headings, and section order used in the',
    '  current issue body (for example bug report vs feature request).',
    '  Ensure each template question is answered explicitly where possible.',
    '  Return null if the original description is already sufficiently clear OR if the',
    '  current issue body (shown in the preamble under "Body:") already matches the',
    '  clarifications — i.e. the author has already updated it.',
  ].join("\n");

  callModel({
    model: "gpt-4o-mini",
    max_tokens: 1024,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  }, (content) => {
    let result;
    try { result = JSON.parse(content); } catch {
      console.error("Failed to parse JSON from model:", content);
      process.exit(1);
    }

    const normalizedResult = normalizeModelResult(result);
    const commentBody = buildAnnotatedCommentBody(result, previousQuestions);
    if (commentBody) {

      console.log(`Patching comment ${botComment.id}…`);
      execFileSync("gh", [
        "api", `repos/${repo}/issues/comments/${botComment.id}`,
        "--method", "PATCH",
        "--input", "-",
      ], {
        input: JSON.stringify({ body: commentBody }),
        stdio: ["pipe", "inherit", "inherit"],
        env: { ...process.env },
      });
      console.log("Comment updated.");
    } else {
      console.log("Model returned invalid annotated body; preserving existing questions.");
    }

    if (normalizedResult.newQuestions) {
      postComment(normalizedResult.newQuestions);
    } else {
      console.log("No new questions needed.");
    }
  });
}

if (require.main === module) {
  if (eventAction === "edited" || eventAction === "created") {
    handleEdited();
  } else {
    handleOpened();
  }
}

module.exports = {
  hasNumberedQuestions,
  splitPreviousQuestions,
  normalizeOptionalString,
  normalizeModelResult,
  includesSameQuestionNumbers,
  buildAnnotatedCommentBody,
};

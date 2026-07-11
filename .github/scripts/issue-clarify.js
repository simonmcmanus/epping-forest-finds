const fs = require("fs");
const https = require("https");
const { execFileSync } = require("child_process");

const issueNumber = process.env.ISSUE_NUMBER;
const issueTitle = process.env.ISSUE_TITLE || "";
const issueBody = process.env.ISSUE_BODY || "(No body provided)";
const eventAction = process.env.EVENT_ACTION || "opened";

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
  let allComments = [];
  try {
    const raw = execFileSync("gh", ["issue", "view", issueNumber, "--json", "comments"], {
      env: { ...process.env },
    }).toString();
    allComments = JSON.parse(raw).comments || [];
  } catch (e) {
    console.error("Failed to fetch comments:", e.message);
    process.exit(1);
  }

  const botComment = [...allComments].reverse().find(c => c.author.login === "github-actions[bot]");

  if (!botComment) {
    handleOpened();
    return;
  }

  const humanReplies = allComments
    .filter(c => c.author.login !== "github-actions[bot]")
    .map(c => `[${c.author.login}]: ${c.body}`)
    .join("\n\n") || "(No replies yet)";

  const prompt = [
    preamble,
    "The issue has been edited. Below are the clarifying questions previously asked,",
    "followed by all human replies.",
    "",
    "## Previous questions",
    botComment.body,
    "",
    "## Replies so far",
    humanReplies,
    "",
    "---",
    "",
    'Return a JSON object with exactly two fields:',
    '- "annotated": the previous questions comment verbatim, but with one of these emojis',
    '  prefixed to each numbered question line:',
    '  ✅ clearly and fully answered',
    '  💬 partially answered or needs more detail',
    '  ❓ not yet answered',
    '  Do not change the intro line or any other text.',
    '- "new_questions": a numbered list (with a short friendly intro line) of any important',
    '  remaining questions not yet covered — or null if nothing important is missing.',
    '  Err strongly on the side of null.',
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

    if (result.annotated && botComment.databaseId) {
      const repo = process.env.GITHUB_REPOSITORY;
      execFileSync("gh", [
        "api", `repos/${repo}/issues/comments/${botComment.databaseId}`,
        "--method", "PATCH",
        "-f", `body=${result.annotated}`,
      ], { stdio: "inherit", env: { ...process.env } });
    }

    if (result.new_questions) {
      postComment(result.new_questions);
    } else {
      console.log("No new questions needed.");
    }
  });
}

if (eventAction === "edited" || eventAction === "created") {
  handleEdited();
} else {
  handleOpened();
}

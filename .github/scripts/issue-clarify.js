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
];

let existingComments = "";
if (eventAction === "edited") {
  try {
    const raw = execFileSync("gh", ["issue", "view", issueNumber, "--json", "comments"], {
      env: { ...process.env },
    }).toString();
    const comments = JSON.parse(raw).comments || [];
    existingComments = comments.length
      ? comments.map((c) => `[${c.author.login}]: ${c.body}`).join("\n\n")
      : "(No comments yet)";
  } catch (e) {
    console.error("Failed to fetch comments:", e.message);
  }
}

const prompt = eventAction === "edited"
  ? [
      ...preamble,
      "Comment history so far:",
      existingComments,
      "",
      "---",
      "",
      "The issue has just been edited. Review the comment history above and decide whether",
      "important clarifying questions still remain unanswered.",
      "",
      "Guidelines:",
      "- Identify any questions previously asked (look for github-actions[bot] comments)",
      "- Check whether they have been addressed in comments or the updated body",
      "- If the issue is now clear enough to implement, respond with exactly: NO_QUESTIONS",
      "- If genuinely important gaps remain, post 1-3 focused new questions — err on the side of silence",
      "- Do not repeat questions already asked or answered",
      "- Format as a numbered list with a short friendly intro line",
    ].join("\n")
  : [
      ...preamble,
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

const payload = JSON.stringify({
  model: "gpt-4o-mini",
  max_tokens: 1024,
  messages: [{ role: "user", content: prompt }],
});

const options = {
  hostname: "models.inference.ai.azure.com",
  path: "/chat/completions",
  method: "POST",
  headers: {
    "Authorization": "Bearer " + process.env.GITHUB_TOKEN,
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  },
};

const req = https.request(options, (res) => {
  let body = "";
  res.on("data", (chunk) => { body += chunk; });
  res.on("end", () => {
    let data;
    try { data = JSON.parse(body); } catch {
      console.error("Failed to parse response:", body);
      process.exit(1);
    }
    const comment = data?.choices?.[0]?.message?.content;
    if (!comment) {
      console.error("Unexpected API response:", body);
      process.exit(1);
    }
    if (comment.trim() === "NO_QUESTIONS") {
      console.log("Issue is sufficiently clear — no new questions needed.");
      return;
    }
    execFileSync("gh", ["issue", "comment", issueNumber, "--body", comment], {
      stdio: "inherit",
      env: { ...process.env },
    });
  });
});

req.on("error", (err) => { console.error(err); process.exit(1); });
req.write(payload);
req.end();

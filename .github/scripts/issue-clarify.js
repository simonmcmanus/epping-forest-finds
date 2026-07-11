const fs = require("fs");
const https = require("https");
const { execFileSync } = require("child_process");

const issueNumber = process.env.ISSUE_NUMBER;
const issueTitle = process.env.ISSUE_TITLE || "";
const issueBody = process.env.ISSUE_BODY || "(No body provided)";

const readFile = (path) => {
  try { return fs.readFileSync(path, "utf8"); } catch { return ""; }
};

const clip = (str, max) => str.length > max ? str.slice(0, max) + "\n...(clipped)" : str;

const projectGuidelines = clip(readFile("CLAUDE.md"), 2000);
const specMain = clip(readFile("spec/spec.md"), 3000);
const specRendering = clip(readFile("spec/spec-data-rendering.md"), 2000);
const glossary = clip(readFile("spec/glossary.md"), 1000);

const prompt = [
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
  "A new GitHub issue has been filed:",
  "",
  "Title: " + issueTitle,
  "",
  "Body:",
  issueBody,
  "",
  "---",
  "",
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
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      console.error("Unexpected API response:", body);
      process.exit(1);
    }

    // Split numbered list items into separate comments for threading
    const lines = content.split("\n");
    const questions = [];
    let current = null;
    for (const line of lines) {
      if (/^\d+\./.test(line.trim())) {
        if (current !== null) questions.push(current.trim());
        current = line;
      } else if (current !== null) {
        current += "\n" + line;
      }
    }
    if (current !== null) questions.push(current.trim());

    for (const q of questions) {
      execFileSync("gh", ["issue", "comment", issueNumber, "--body", q], {
        stdio: "inherit",
        env: { ...process.env },
      });
    }
  });
});

req.on("error", (err) => { console.error(err); process.exit(1); });
req.write(payload);
req.end();

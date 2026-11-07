"""Execute the workflow-owned review publisher against a fake GitHub boundary.

No repository code is checked out by the write-token job. Extracting its actual
JavaScript here tests what that job executes without duplicating the publisher
or requiring a YAML package in CI's Python environment.
"""
import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / ".github/workflows/ci.yml"
HEAD = "a" * 40
OTHER = "b" * 40
BASE = "c" * 40


def workflow_script(step_name):
    lines = WORKFLOW.read_text().splitlines()
    step = lines.index("      - name: " + step_name)
    start = next(i for i in range(step, len(lines)) if lines[i] == "          script: |") + 1
    end = start
    while end < len(lines) and (not lines[end].strip() or lines[end].startswith("            ")):
        end += 1
    return "\n".join(line[12:] for line in lines[start:end])


HARNESS = r"""
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
process.env.REVIEW_HEAD_SHA = 'a'.repeat(40);
process.env.REVIEW_BASE_SHA = 'c'.repeat(40);
process.env.REVIEW_RESULT = input.raw === undefined ? JSON.stringify(input.result) : input.raw;
process.env.REVIEW_MODEL_RESULT = input.modelResult || 'success';
process.env.REVIEW_SESSION = input.session || 'session_test-123';
const repo = {owner: 'owner', repo: 'repo'};
const calls = [], reviews = [], notices = [], summaries = [];
let headReads = 0;
const pr = {state: 'open', draft: false, changed_files: input.files.length, base: {sha: 'c'.repeat(40)},
  head: {sha: 'a'.repeat(40), repo: {full_name: 'owner/repo'}}, ...input.pr};
const endpoints = {
  get: async request => {
    calls.push(['get', request]); headReads++;
    const current = structuredClone(pr);
    if (input.headChangesAt && headReads >= input.headChangesAt) current.head.sha = 'b'.repeat(40);
    if (input.baseChangesAt && headReads >= input.baseChangesAt) current.base.sha = 'b'.repeat(40);
    return {data: current};
  },
  listFiles: 'files', listReviews: 'reviews',
  createReview: async request => { reviews.push(request); return {data: {id: 42}}; }
};
const github = {rest: {pulls: endpoints}, paginate: async (endpoint, request) => {
  calls.push([endpoint, request]);
  if (request.per_page !== 100) throw new Error('Expected paginated API request');
  return endpoint === 'files' ? input.files : (input.reviews || []);
}};
const summary = {addRaw(text) { summaries.push(text); return this; }, async write() {}};
const core = {notice: text => notices.push(text), summary};
const context = {repo, payload: {pull_request: {number: 12}, repository: {full_name: 'owner/repo'}}};
(async () => {
  let error = null;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    await new AsyncFunction('github', 'context', 'core', input.script)(github, context, core);
  } catch (e) { error = e.message; }
  process.stdout.write(JSON.stringify({error, reviews, calls, notices, summaries}));
})();
"""


class ClaudeReviewPublicationTests(unittest.TestCase):
    def run_publisher(self, **overrides):
        case = {
            "script": workflow_script("Validate and publish pinned review"),
            "result": {"head_sha": HEAD, "base_sha": BASE, "complete": True, "findings": []},
            "files": [{"filename": "js/example.js", "patch": "@@ -3,2 +3,3 @@\n context\n-old\n+new\n+more"}],
        }
        case.update(overrides)
        completed = subprocess.run(
            ["node", "-e", HARNESS], input=json.dumps(case), text=True,
            capture_output=True, check=True, cwd=ROOT,
        )
        return json.loads(completed.stdout)

    def finding(self, **overrides):
        item = {"axis": "Spec", "priority": 1, "path": "js/example.js", "line": 5, "side": "RIGHT",
                "title": "Denied permission replaces setup", "body": "On first-visit refusal, the layers hint is lost. Preserve the setup card."}
        item.update(overrides)
        return item

    def result(self, *findings, **overrides):
        return {"head_sha": HEAD, "base_sha": BASE, "complete": True, "findings": list(findings), **overrides}

    def assert_rejected(self, output):
        self.assertIsNotNone(output["error"])
        self.assertEqual(output["reviews"], [])

    def test_clean_complete_review_approves_only_the_pinned_head(self):
        output = self.run_publisher()
        self.assertIsNone(output["error"])
        self.assertEqual(len(output["reviews"]), 1)
        review = output["reviews"][0]
        self.assertEqual((review["commit_id"], review["event"], review["comments"]), (HEAD, "APPROVE", []))
        self.assertEqual((review["owner"], review["repo"], review["pull_number"]), ("owner", "repo", 12))

    def test_verified_finding_requests_changes_at_its_added_right_line(self):
        output = self.run_publisher(result=self.result(self.finding()))
        self.assertIsNone(output["error"])
        review = output["reviews"][0]
        self.assertEqual(review["event"], "REQUEST_CHANGES")
        self.assertEqual(review["commit_id"], HEAD)
        self.assertEqual(review["comments"][0]["line"], 5)
        self.assertEqual(review["comments"][0]["side"], "RIGHT")
        self.assertIn("CLAUDE_REVIEW_FINDING\n[P1]", review["comments"][0]["body"])
        self.assertIn("Spec: 1 (P1)", review["body"])

    def test_obsolete_head_is_discarded_even_when_the_old_model_failed(self):
        output = self.run_publisher(headChangesAt=1, modelResult="failure")
        self.assertIsNone(output["error"])
        self.assertEqual(output["reviews"], [])
        self.assertEqual(len(output["calls"]), 1)

    def test_head_change_during_validation_discards_review(self):
        output = self.run_publisher(headChangesAt=2)
        self.assertIsNone(output["error"])
        self.assertEqual(output["reviews"], [])

    def test_head_change_immediately_before_publication_discards_review(self):
        output = self.run_publisher(headChangesAt=3)
        self.assertIsNone(output["error"])
        self.assertEqual(output["reviews"], [])

    def test_target_base_change_fails_the_still_current_head_without_publishing(self):
        for when in (1, 2, 3):
            with self.subTest(when=when):
                output = self.run_publisher(baseChangesAt=when)
                self.assert_rejected(output)
                self.assertIn("Target base changed", output["error"])

    def test_closed_draft_and_foreign_repository_heads_do_not_publish(self):
        for pr in ({"state": "closed"}, {"draft": True},
                   {"head": {"sha": HEAD, "repo": {"full_name": "outsider/repo"}}}):
            with self.subTest(pr=pr):
                output = self.run_publisher(pr=pr)
                self.assertIsNone(output["error"])
                self.assertEqual(output["reviews"], [])

    def test_missing_or_failed_model_does_not_approve(self):
        for result in ("failure", "cancelled", "skipped"):
            with self.subTest(result=result):
                self.assert_rejected(self.run_publisher(modelResult=result))

    def test_missing_malformed_and_oversized_output_do_not_approve(self):
        for raw in ("", "not json", "null", "[]", "x" * 50001):
            with self.subTest(raw=raw[:20]):
                self.assert_rejected(self.run_publisher(raw=raw))

    def test_partial_wrong_head_and_unbounded_results_do_not_approve(self):
        for result in (self.result(complete=False), self.result(head_sha=OTHER), self.result(base_sha=OTHER),
                       self.result(*[self.finding()] * 21), self.result(findings="none")):
            with self.subTest(result=str(result)[:100]):
                self.assert_rejected(self.run_publisher(result=result))

    def test_findings_must_have_supported_priorities_and_concrete_content(self):
        for update in ({"priority": 3}, {"priority": 1.5}, {"priority": "1"},
                       {"axis": "Taste"}, {"title": ""}, {"body": " "},
                       {"title": "x" * 121}, {"body": "x" * 1601}):
            with self.subTest(update=str(update)[:80]):
                self.assert_rejected(self.run_publisher(result=self.result(self.finding(**update))))

    def test_context_unchanged_files_and_invalid_lines_cannot_receive_findings(self):
        for update in ({"line": 3}, {"line": 2}, {"line": -1}, {"line": 4.5},
                       {"line": 6}, {"path": "js/unchanged.js"}):
            with self.subTest(update=update):
                self.assert_rejected(self.run_publisher(result=self.result(self.finding(**update))))

    def test_a_removed_guard_can_be_reported_on_its_deleted_left_line(self):
        output = self.run_publisher(
            files=[{"filename": "js/example.js", "patch": "@@ -10,2 +10 @@\n-if (!authorized) return;\n render();"}],
            result=self.result(self.finding(line=10, side="LEFT")))
        self.assertIsNone(output["error"])
        self.assertEqual(output["reviews"][0]["comments"][0]["side"], "LEFT")
        self.assertEqual(output["reviews"][0]["comments"][0]["line"], 10)

    def test_unchanged_left_lines_and_unsupported_sides_are_rejected(self):
        for update in ({"side": "LEFT", "line": 3}, {"side": "LEFT", "line": 5},
                       {"side": "CENTER"}, {"side": None}):
            with self.subTest(update=update):
                self.assert_rejected(self.run_publisher(result=self.result(self.finding(**update))))

    def test_files_without_patches_cannot_receive_guessed_line_findings(self):
        self.assert_rejected(self.run_publisher(
            files=[{"filename": "js/example.js"}], result=self.result(self.finding())))

    def test_hunk_offsets_and_deletions_use_right_side_line_numbers(self):
        output = self.run_publisher(
            files=[{"filename": "js/example.js", "patch": "@@ -90,5 +100,4 @@\n context\n-old\n-old\n+new\n context\n+newer"}],
            result=self.result(self.finding(line=103)))
        self.assertIsNone(output["error"])
        self.assertEqual(output["reviews"][0]["comments"][0]["line"], 103)

    def test_incomplete_file_pagination_fails_closed(self):
        self.assert_rejected(self.run_publisher(pr={"changed_files": 2}))

    def test_finding_in_later_file_page_can_be_published(self):
        files = [{"filename": f"data/file-{i}.json"} for i in range(101)]
        files.append({"filename": "js/example.js", "patch": "@@ -4 +5 @@\n-old\n+new"})
        output = self.run_publisher(files=files, result=self.result(self.finding()))
        self.assertIsNone(output["error"])
        self.assertEqual(len(output["reviews"]), 1)

    def test_previous_publisher_retry_on_later_review_page_is_idempotent(self):
        reviews = [{"user": {"login": "human"}, "body": "review"} for _ in range(101)]
        reviews.append({"user": {"login": "github-actions[bot]"}, "commit_id": HEAD,
                        "state": "APPROVED", "body": f"<!-- CLAUDE_FINAL_REVIEW:{HEAD}:{BASE} -->"})
        output = self.run_publisher(reviews=reviews)
        self.assertIsNone(output["error"])
        self.assertEqual(output["reviews"], [])

    def test_human_marker_and_other_head_review_do_not_suppress_current_review(self):
        reviews = [
            {"user": {"login": "human"}, "commit_id": HEAD, "state": "APPROVED",
             "body": f"<!-- CLAUDE_FINAL_REVIEW:{HEAD}:{BASE} -->"},
            {"user": {"login": "github-actions[bot]"}, "commit_id": OTHER, "state": "APPROVED",
             "body": f"<!-- CLAUDE_FINAL_REVIEW:{HEAD}:{BASE} -->"},
        ]
        output = self.run_publisher(reviews=reviews)
        self.assertIsNone(output["error"])
        self.assertEqual(len(output["reviews"]), 1)

    def test_a_review_against_an_older_base_does_not_suppress_a_current_base_review(self):
        reviews = [{"user": {"login": "github-actions[bot]"}, "commit_id": HEAD,
                    "state": "APPROVED", "body": f"<!-- CLAUDE_FINAL_REVIEW:{HEAD}:{OTHER} -->"}]
        output = self.run_publisher(reviews=reviews)
        self.assertIsNone(output["error"])
        self.assertEqual(len(output["reviews"]), 1)

    def test_duplicate_findings_do_not_produce_repeated_comments(self):
        self.assert_rejected(self.run_publisher(result=self.result(self.finding(), self.finding())))

    def test_summary_contains_usage_correlation_without_untrusted_session_text(self):
        output = self.run_publisher(session="<script>unsafe</script>")
        self.assertIsNone(output["error"])
        summary = output["summaries"][0]
        self.assertIn("Model: sonnet; turn limit: 30", summary)
        self.assertIn("Session: unavailable", summary)
        self.assertNotIn("<script>", summary)


PREPARE_HARNESS = r"""
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const writes = [], calls = [];
const pr = {number: 12, state: 'open', draft: false, title: 'Scoped correction',
  body: input.body || 'Requirements', changed_files: input.files.length,
  head: {sha: 'a'.repeat(40)}, base: {sha: 'c'.repeat(40)}, ...input.pr};
const github = {rest: {pulls: {listFiles: 'files', get: async request => {
  calls.push(['get', request]); return {data: {...pr, ...input.live}};
}}}, paginate: async (endpoint, request) => {
  calls.push([endpoint, request]);
  if (endpoint !== 'files' || request.per_page !== 100) throw new Error('Expected paginated file request');
  return input.files;
}};
const context = {repo: {owner: 'owner', repo: 'repo'}, payload: {pull_request: pr}};
const fakeRequire = name => {
  if (name !== 'node:fs') throw new Error('Unexpected module');
  return {writeFileSync: (path, body) => writes.push({path, body: JSON.parse(body)})};
};
(async () => {
  let error = null;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    await new AsyncFunction('github', 'context', 'require', input.script)(github, context, fakeRequire);
  } catch (e) { error = e.message; }
  process.stdout.write(JSON.stringify({error, writes, calls}));
})();
"""


class ClaudeReviewPreparationTests(unittest.TestCase):
    def prepare(self, **overrides):
        case = {"script": workflow_script("Prepare compact review context"),
                "files": [{"filename": "js/example.js", "patch": "@@ -1 +1 @@\n-old\n+new"}]}
        case.update(overrides)
        completed = subprocess.run(["node", "-e", PREPARE_HARNESS], input=json.dumps(case),
                                   text=True, capture_output=True, check=True, cwd=ROOT)
        return json.loads(completed.stdout)

    def test_changed_code_produces_pinned_context_without_generated_preview_noise(self):
        output = self.prepare(body="Requirement\n<!-- preview-links:start -->huge links<!-- preview-links:end -->\n<!-- visual-failures:start -->image table<!-- visual-failures:end -->")
        self.assertIsNone(output["error"])
        self.assertEqual(len(output["writes"]), 1)
        packet = output["writes"][0]["body"]
        self.assertEqual((packet["head_sha"], packet["base_sha"]), (HEAD, BASE))
        self.assertEqual(packet["requirements"].strip(), "Requirement")
        self.assertEqual(packet["files"][0]["path"], "js/example.js")
        self.assertIn("+new", packet["files"][0]["patch"])

    def test_modifying_adding_or_deleting_ci_owned_cache_markers_stops_before_model_context(self):
        for path in ("js/app-cache-version.js", "js/data-cache-version.js"):
            for status in ("modified", "added", "removed"):
                with self.subTest(path=path, status=status):
                    output = self.prepare(files=[{"filename": path, "status": status}])
                    self.assertIn("Cache markers are CI-owned", output["error"])
                    self.assertEqual(output["writes"], [])

    def test_renaming_a_ci_owned_marker_is_not_a_guard_bypass(self):
        output = self.prepare(files=[{"filename": "js/renamed-marker.js", "previous_filename": "js/app-cache-version.js", "status": "renamed"}])
        self.assertIn("Cache markers are CI-owned", output["error"])
        self.assertEqual(output["writes"], [])

    def test_marker_changes_on_later_file_pages_are_rejected(self):
        files = [{"filename": f"data/file-{i}.json"} for i in range(101)]
        files.append({"filename": "js/data-cache-version.js"})
        output = self.prepare(files=files)
        self.assertIn("Cache markers are CI-owned", output["error"])
        self.assertEqual(output["writes"], [])

    def test_ordinary_cache_behavior_changes_are_still_reviewed(self):
        output = self.prepare(files=[{"filename": "sw.js", "status": "modified"}])
        self.assertIsNone(output["error"])
        self.assertEqual(output["writes"][0]["body"]["files"][0]["path"], "sw.js")

    def test_stale_closed_or_draft_context_stops_before_loading_files(self):
        for live in ({"head": {"sha": OTHER}}, {"base": {"sha": OTHER}},
                     {"state": "closed"}, {"draft": True}):
            with self.subTest(live=live):
                output = self.prepare(live=live)
                self.assertIn("changed before inspection", output["error"])
                self.assertEqual(output["writes"], [])
                self.assertEqual(len(output["calls"]), 1)

    def test_incomplete_file_list_cannot_produce_a_clean_context(self):
        output = self.prepare(pr={"changed_files": 2})
        self.assertIn("Incomplete PR file list", output["error"])
        self.assertEqual(output["writes"], [])


if __name__ == "__main__":
    unittest.main()

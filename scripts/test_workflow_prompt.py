#!/usr/bin/env python3
"""
Guards the weekly workflow against the failure that broke it once.

GitHub Actions parses any `with:` value containing `${{ }}` as a template
expression, and an expression may not exceed 21,000 characters. The weekly
job's prompt is longer than that, so a single `${{ }}` anywhere inside it
makes the entire workflow file invalid -- and the way that surfaces is
brutal: every run, including the scheduled Monday one, fails at startup with
"Invalid workflow file" before a line of it executes. Nothing in the normal
test suite touched the workflow, so it broke on a Sunday and stayed broken.

Anything the prompt needs from the Actions context goes in the step's `env:`
and is referred to as a shell variable instead.

Run: python3 scripts/test_workflow_prompt.py
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / ".github" / "workflows" / "weekly-ledger.yml"

MAX_EXPRESSION_LENGTH = 21000
EXPRESSION = re.compile(r"\$\{\{.*?\}\}", re.DOTALL)


def block_values(text):
    """Every YAML block scalar (`key: |` and its indented body) in the file,
    which is the shape a long prompt takes and the only place long enough to
    run into the limit."""
    blocks = []
    lines = text.splitlines()
    for index, line in enumerate(lines):
        stripped = line.rstrip()
        if not stripped.endswith((": |", ": |-", ": >", ": >-")):
            continue
        indent = len(line) - len(line.lstrip())
        body = []
        for following in lines[index + 1:]:
            if following.strip() and (len(following) - len(following.lstrip())) <= indent:
                break
            body.append(following)
        blocks.append((stripped.strip().split(":")[0], "\n".join(body)))
    return blocks


class WorkflowPromptTests(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text()

    def test_the_workflow_still_exists_where_this_expects_it(self):
        self.assertTrue(WORKFLOW.exists(), f"{WORKFLOW} is missing")

    def test_no_block_carries_both_an_expression_and_more_than_actions_allows(self):
        for name, body in block_values(self.text):
            if EXPRESSION.search(body):
                self.assertLessEqual(
                    len(body), MAX_EXPRESSION_LENGTH,
                    f"the {name!r} block is {len(body)} characters and contains a ${{{{ }}}} "
                    "expression, so Actions will reject the whole workflow file. Move what it "
                    "needs into the step's env: and refer to it as a shell variable.",
                )

    def test_the_prompt_carries_no_actions_expression_at_all(self):
        # Belt and braces: the prompt is well past the limit and only grows,
        # so the rule for it is simply "no ${{ }}", not "not too much of it".
        prompt = dict(block_values(self.text)).get("prompt")
        self.assertIsNotNone(prompt, "the weekly workflow should still have a prompt block")
        found = EXPRESSION.findall(prompt)
        self.assertEqual(
            found, [],
            f"the prompt contains {found}. Anything it needs from the Actions context goes in "
            "the step's env: (see RUN_NUMBER) and is used as a shell variable.",
        )

    def test_anything_the_prompt_refers_to_is_actually_provided(self):
        prompt = dict(block_values(self.text)).get("prompt") or ""
        for variable in sorted(set(re.findall(r"\$([A-Z][A-Z0-9_]{2,})", prompt))):
            # A plain boolean rather than assertRegex: the haystack is the
            # whole workflow file, and unittest prints the haystack on
            # failure, which buries the one line that matters.
            provided = re.search(rf"^\s+{variable}:\s", self.text, re.MULTILINE)
            self.assertTrue(
                provided,
                f"the prompt uses ${variable} but no env: entry sets it, so the run would "
                "quietly substitute an empty string",
            )


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False).result.wasSuccessful() else 1)

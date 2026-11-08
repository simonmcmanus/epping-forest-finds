"""Exercise the visual job's Git setup with Git's different-owner test mode.

Execute its early shell steps, rather than asserting how trust is configured.
No YAML dependency is needed: this harness supports the literal run blocks and
simple event guard used before setup-node in the visual job.
"""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


def setup_steps():
    job = (ROOT / '.github/workflows/ci.yml').read_text().split('  visual-snapshots:\n', 1)[1]
    prefix = job.split('      - uses: actions/setup-node@', 1)[0]
    for step in re.split(r'^      - ', prefix, flags=re.MULTILINE)[1:]:
        guard = re.search(r'^        if: (.+)$', step, re.MULTILINE)
        run = re.search(r'^        run: (.+)$', step, re.MULTILINE)
        if not run:
            continue  # checkout is provided by the fixture below
        if run[1] == '|':
            body = []
            for line in step[run.end():].splitlines()[1:]:
                if line.strip() and not line.startswith('          '):
                    break
                body.append(line[10:])
            script = '\n'.join(body)
        else:
            script = run[1]
        yield guard[1] if guard else None, script


class VisualWorkspaceTests(unittest.TestCase):
    def test_reporter_can_read_checkout_for_every_event_without_trusting_other_repositories(self):
        for event in ('push', 'pull_request', 'workflow_dispatch'):
            with self.subTest(event=event), tempfile.TemporaryDirectory() as folder:
                base = Path(folder)
                repo = base / 'checkout with spaces'
                other = base / 'unrelated'
                home = base / 'home'
                home.mkdir()
                env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
                env.update(HOME=str(home), GIT_CONFIG_NOSYSTEM='1',
                           XDG_CONFIG_HOME=str(home / '.config'))
                for directory in (repo, other):
                    subprocess.run(['git', 'init', '-q', str(directory)], env=env, check=True)
                snapshot = repo / 'test/e2e/__screenshots__/map-mobile-linux.png'
                snapshot.parent.mkdir(parents=True)
                snapshot.write_bytes(b'fixture')
                subprocess.run(['git', 'add', '.'], cwd=repo, env=env, check=True)
                env.update(GIT_TEST_ASSUME_DIFFERENT_OWNER='true', GITHUB_WORKSPACE=str(repo),
                           GITHUB_STEP_SUMMARY=str(base / 'summary'),
                           VISUAL_EVIDENCE_DIR=str(base / 'evidence'), VISUAL_PROJECT='mobile')

                def git_files(directory):
                    return subprocess.run(['git', 'ls-files', 'test/e2e/__screenshots__'],
                                          cwd=directory, env=env, capture_output=True, text=True)

                before = git_files(repo)
                self.assertNotEqual(before.returncode, 0)
                self.assertIn('dubious ownership', before.stderr)
                for guard, script in setup_steps():
                    if guard:
                        match = re.fullmatch(r"github.event_name == '([^']+)'", guard)
                        self.assertIsNotNone(match, f'Unsupported workflow guard: {guard}')
                        if match[1] != event:
                            continue
                    result = subprocess.run(['bash', '-e', '-c', script], cwd=repo, env=env,
                                            capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                # Invoke the production reporter constructor: this is the Git call
                # that aborted the entire visual job before tests could start.
                result = subprocess.run(['node', '-e',
                                         'const Reporter = require(process.argv[1]); '
                                         'const reporter = new Reporter(); '
                                         'console.log(JSON.stringify([...reporter.tracked]));',
                                         str(ROOT / '.github/scripts/visual-reporter.cjs')],
                                        cwd=repo, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), '["test/e2e/__screenshots__/map-mobile-linux.png"]')
                self.assertEqual((base / 'summary').exists(), event == 'pull_request')
                untrusted = git_files(other)
                self.assertNotEqual(untrusted.returncode, 0)
                self.assertIn('dubious ownership', untrusted.stderr)


if __name__ == '__main__':
    unittest.main()

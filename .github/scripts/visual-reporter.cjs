const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

class VisualReporter {
  constructor() {
    this.entries = new Map();
    this.imageIndex = 0;
    this.errors = [];
    this.dir = process.env.VISUAL_EVIDENCE_DIR;
    this.project = process.env.VISUAL_PROJECT;
    this.tracked = new Set(execFileSync('git', ['ls-files', 'test/e2e/__screenshots__'], { encoding: 'utf8' }).trim().split('\n'));
    fs.mkdirSync(this.dir, { recursive: true });
  }
  onTestEnd(test, result) {
    const previous = this.entries.get(test.id);
    const images = [];
    for (const attachment of result.attachments) {
      if (!attachment.path || !/-(expected|actual|diff)\.png$/.test(attachment.name)) continue;
      const file = `${this.imageIndex++}.png`;
      fs.copyFileSync(attachment.path, path.join(this.dir, file));
      images.push({ name: attachment.name, file });
    }
    this.entries.set(test.id, {
      name: test.titlePath().slice(1).join(' / '),
      status: result.status === 'skipped' ? 'skipped' : result.status === test.expectedStatus ? 'passed' : 'failed',
      missingBaseline: Boolean(result.errors?.some((error) => /A snapshot doesn't exist/.test(error.message || ''))),
      flaky: Boolean(previous && ((previous.status === 'failed' && !previous.missingBaseline) || previous.flaky)),
      images,
    });
  }
  onError(error) {
    this.errors.push(error.message || String(error));
  }
  onEnd(result) {
    const added = [];
    const prefix = 'test/e2e/__screenshots__/';
    for (const file of fs.readdirSync(prefix)) {
      if (!file.endsWith(`-${this.project}-linux.png`) || this.tracked.has(prefix + file)) continue;
      const target = `added-${added.length}.png`;
      fs.copyFileSync(prefix + file, path.join(this.dir, target));
      added.push({ name: file, file: target });
    }
    fs.writeFileSync(path.join(this.dir, 'manifest.json'), JSON.stringify({
      version: 1, project: this.project, status: result.status,
      tests: [...this.entries.values()], added, errors: this.errors,
    }));
  }
}
module.exports = VisualReporter;

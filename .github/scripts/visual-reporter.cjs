const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function hasPixelDifference(result) {
  const errors = result.errors?.length ? result.errors : result.error ? [result.error] : [];
  const images = (result.attachments || []).filter((item) => item.contentType === 'image/png');
  return errors.length > 0 && images.some((item) => /(?:^|[-_])actual(?:[.-]|$)/.test(item.name || '')) &&
    errors.every((error) => {
      const message = (error.message || error.value || '').replace(/\u001b\[[0-9;]*m/g, '');
      return /expect\([^\n]*\)\.toHaveScreenshot\(/.test(message) &&
        /\d+ pixels? .*different|Expected an image .*received an image|Expected an image .*received /s.test(message);
    });
}

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
    const missingBaseline = Boolean(result.errors?.some((error) => /A snapshot doesn't exist/.test(error.message || '')));
    const pixelDifference = hasPixelDifference(result);
    for (const attachment of result.attachments) {
      if (!attachment.path || !/-(expected|actual|diff)\.png$/.test(attachment.name)) continue;
      const file = `${this.imageIndex++}.png`;
      fs.copyFileSync(attachment.path, path.join(this.dir, file));
      images.push({ name: attachment.name, file });
    }
    this.entries.set(test.id, {
      name: test.titlePath().slice(1).join(' / '),
      status: result.status === 'skipped' ? 'skipped' : result.status === test.expectedStatus ? 'passed' : 'failed',
      missingBaseline,
      pixelDifference,
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
    // Pixel mismatches are intentionally advisory: classify-visual-results.js emits the warning
    // and the publisher preserves the before/after/diff evidence. Launch, setup, assertion and
    // timeout failures remain blocking here.
    const blockingFailure = [...this.entries.values()].some((entry) =>
      entry.status === 'failed' && !entry.missingBaseline && !entry.pixelDifference);
    const advisoryOnlyFailure = result.status === 'failed' && this.entries.size > 0
      && !this.errors.length && !blockingFailure;
    const status = result.status === 'skipped' ? 'skipped'
      : result.status === 'failed' && advisoryOnlyFailure ? 'passed' : 'failed';
    fs.writeFileSync(path.join(this.dir, 'manifest.json'), JSON.stringify({
      version: 1, project: this.project, status,
      tests: [...this.entries.values()], added, errors: this.errors,
    }));
  }
}
module.exports = VisualReporter;

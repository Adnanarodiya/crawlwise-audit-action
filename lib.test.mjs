import assert from 'node:assert/strict';
import test from 'node:test';
import { baselineFromRuns, diffChecks, highestSeverity, normaliseAuditUrl, renderComment, shouldFail } from './lib.mjs';

const check = (id, status, detail = '') => ({ id, title: id, status, detail });

test('a check that stopped passing is a regression', () => {
  const changes = diffChecks([check('title', 'pass')], [check('title', 'fail')]);
  assert.equal(changes[0].kind, 'regression');
  assert.equal(changes[0].severity, 'warning');
  assert.equal(shouldFail(changes, 'warning'), true);
});

test('a check that did not run on the baseline is not a regression', () => {
  const changes = diffChecks([], [check('title', 'fail')]);
  assert.equal(changes[0].kind, 'new');
  assert.equal(changes[0].severity, 'info');
  assert.equal(shouldFail(changes, 'warning'), false);
  assert.equal(shouldFail(changes, 'critical'), false);
});

test('an index regression is critical and fails a default build', () => {
  const changes = diffChecks([check('index', 'pass')], [check('index', 'fail', 'noindex')]);
  assert.equal(changes[0].severity, 'critical');
  assert.equal(shouldFail(changes, 'critical'), true);
  assert.equal(shouldFail(changes, 'never'), false);
});

test('an AI crawler losing access is critical', () => {
  const changes = diffChecks([check('ai-crawler-access', 'pass')], [check('ai-crawler-access', 'fail')]);
  assert.equal(changes[0].severity, 'critical');
});

test('a wording change is info and never fails the build', () => {
  const changes = diffChecks([check('description', 'pass', 'Good length')], [check('description', 'pass', 'Slightly long')]);
  assert.equal(changes[0].kind, 'wording');
  assert.equal(changes[0].severity, 'info');
  assert.equal(shouldFail(changes, 'warning'), false);
  assert.equal(highestSeverity(changes), 'info');
});

test('a check that no longer runs is not a fix', () => {
  const changes = diffChecks([check('viewport', 'fail')], []);
  assert.equal(changes[0].kind, 'dropped');
  assert.equal(shouldFail(changes, 'warning'), false);
});

test('the comment names the regressions and keeps the marker for updating in place', () => {
  const changes = diffChecks([check('title', 'pass')], [check('title', 'fail', 'Missing title')]);
  const body = renderComment({ hostname: 'example.com', url: 'https://example.com/', changes, baseline: 'run-1', failed: true });
  assert.match(body, /<!-- crawlwise-report -->/);
  assert.match(body, /example\.com/);
  assert.match(body, /Compared against run-1/);
  assert.match(body, /1 regression/);
  assert.match(body, /Missing title/);
});

test('a clean run renders no regression section', () => {
  const body = renderComment({ hostname: 'example.com', url: 'https://example.com/', changes: [], baseline: null, failed: false });
  assert.match(body, /No regressions/);
  assert.doesNotMatch(body, /### Regressions/);
});

test('the baseline comes from a stored run of the same URL, never a guess', () => {
  const runs = [{ id: 'a', url: 'https://other.com/' }, { id: 'b', url: 'https://example.com/' }];
  assert.equal(baselineFromRuns(runs, 'https://example.com/'), 'b');
  assert.equal(baselineFromRuns(runs, 'https://third.com/'), null);
});

test('the automatic baseline skips the run being judged', () => {
  // Newest first, as GET /v1/audits returns them. run-now is this audit's own report.
  const runs = [
    { id: 'run-now', url: 'https://example.com/', createdAt: '2026-10-12T10:05:00.000Z' },
    { id: 'run-old', url: 'https://example.com/', createdAt: '2026-10-11T09:00:00.000Z' },
  ];
  assert.equal(baselineFromRuns(runs, 'https://example.com/', { exclude: ['job-1', 'run-now'] }), 'run-old');
  // Without a run id from the server, anything stored after the audit began is this run.
  assert.equal(baselineFromRuns(runs, 'https://example.com/', { before: '2026-10-12T10:00:00.000Z' }), 'run-old');
  assert.equal(baselineFromRuns([runs[0]], 'https://example.com/', { exclude: ['run-now'] }), null);
});

test('the baseline matches the URL the way the server stores it', () => {
  assert.equal(normaliseAuditUrl('example.com'), 'https://example.com/');
  assert.equal(normaliseAuditUrl('https://Example.COM./#top'), 'https://example.com/');
  assert.equal(normaliseAuditUrl('https://example.com/blog?a=1'), 'https://example.com/blog?a=1');
  const runs = [{ id: 'b', url: 'https://example.com/' }];
  assert.equal(baselineFromRuns(runs, 'example.com'), 'b');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { baselineFromRuns, diffChecks, highestSeverity, renderComment, shouldFail } from './lib.mjs';

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

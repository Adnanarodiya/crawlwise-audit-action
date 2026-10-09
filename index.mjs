import { appendFileSync } from 'node:fs';
import { baselineFromRuns, diffChecks, highestSeverity, renderComment, shouldFail } from './lib.mjs';

const endpoint = (process.env.INPUT_ENDPOINT || 'https://crawlwise.site').replace(/\/+$/, '');
const apiKey = process.env.INPUT_API_KEY || '';
const url = process.env.INPUT_URL || '';
const failOn = process.env.INPUT_FAIL_ON || 'critical';
const wantComment = (process.env.INPUT_COMMENT || 'true') !== 'false';
const explicitBaseline = process.env.INPUT_BASELINE || '';
const minScore = process.env.INPUT_MIN_SCORE ? Number(process.env.INPUT_MIN_SCORE) : null;
const token = process.env.CRAWLWISE_GITHUB_TOKEN || '';
const event = JSON.parse(process.env.GITHUB_EVENT_PATH ? (await import('node:fs')).readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8') : '{}');

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, name + '=' + String(value) + '\n');
  console.log(name + ': ' + value);
}

function die(message) {
  console.error('crawlwise: ' + message);
  process.exit(1);
}

async function api(path, init = {}) {
  const response = await fetch(endpoint + path, {
    ...init,
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || body.error || 'HTTP ' + response.status);
  return body;
}

async function audit(target) {
  const started = await api('/v1/audits', { method: 'POST', body: JSON.stringify({ url: target }) });
  const id = started.id;
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const job = await api('/v1/audits/' + encodeURIComponent(id));
    if (job.status === 'complete') return { id, report: job.report };
    if (job.status === 'failed' || job.status === 'abandoned') die('the audit of ' + target + ' ' + job.status + ': ' + (job.error || 'no reason given'));
  }
  die('the audit of ' + target + ' did not finish within five minutes');
}

if (!apiKey) die('no api-key was provided');
if (!url) die('no url was provided');

console.log('crawlwise: auditing ' + url);
const current = await audit(url);

let baselineId = explicitBaseline;
let baselineLabel = explicitBaseline ? 'audit ' + explicitBaseline : '';
if (!baselineId) {
  const listed = await api('/v1/audits?limit=20');
  baselineId = baselineFromRuns(listed.audits, url);
  baselineLabel = baselineId ? 'the most recent stored audit of this URL' : '';
}

const before = baselineId ? (await api('/v1/audits/' + encodeURIComponent(baselineId))).report : null;
if (!baselineId) {
  console.log('crawlwise: no earlier audit of this URL, so this run sets the baseline and reports no regressions');
}

const changes = before ? diffChecks(before.checks, current.report?.checks) : [];
const severity = highestSeverity(changes);
const score = current.report?.scoring?.score ?? null;
const belowMin = minScore !== null && Number.isFinite(minScore) && score !== null && score < minScore;
const failed = shouldFail(changes, failOn) || belowMin;

setOutput('audit-id', current.id);
setOutput('severity', severity);
setOutput('score', score ?? 'not-scored');
setOutput('regressions', changes.filter((change) => change.kind === 'regression').length);

const pr = event.pull_request;
if (wantComment && pr && token) {
  const body = renderComment({
    hostname: new URL(url).hostname,
    url,
    changes,
    baseline: baselineLabel,
    failed,
  });
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  const list = await fetch('https://api.github.com/repos/' + process.env.GITHUB_REPOSITORY + '/issues/' + pr.number + '/comments?per_page=100', { headers });
  const existing = Array.isArray(await list.clone().json()) ? (await list.json()).find((comment) => String(comment.body || '').includes('<!-- crawlwise-report -->')) : null;
  const posted = existing
    ? await fetch('https://api.github.com/repos/' + process.env.GITHUB_REPOSITORY + '/issues/comments/' + existing.id, { method: 'PATCH', headers, body: JSON.stringify({ body }) })
    : await fetch('https://api.github.com/repos/' + process.env.GITHUB_REPOSITORY + '/issues/' + pr.number + '/comments', { method: 'POST', headers, body: JSON.stringify({ body }) });
  if (!posted.ok) console.error('crawlwise: the pull-request comment could not be written (' + posted.status + ')');
  else console.log('crawlwise: ' + (existing ? 'updated' : 'posted') + ' the pull-request comment');
} else if (wantComment && !pr) {
  console.log('crawlwise: not a pull request, so nothing was commented');
}

if (belowMin) console.error('crawlwise: score ' + score + ' is below min-score ' + minScore);
if (failed) {
  console.error('crawlwise: ' + highestSeverity(changes) + ' regression found and fail-on is ' + failOn);
  process.exit(1);
}
console.log('crawlwise: no regression at or above ' + failOn);

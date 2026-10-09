/**
 * Severity mirrors `lib/monitors/diff.ts` so a regression the Action fails a
 * build for is the same regression monitoring emails about. A check that did
 * not run last time measured something new and is never a regression.
 */

export const CRITICAL_CHECKS = new Set(['index', 'ai-crawler-access']);
const CRITICAL_ORDER = ['none', 'info', 'warning', 'critical'];

export function severityOf(change) {
  if (change.kind === 'regression' && CRITICAL_CHECKS.has(change.id)) return 'critical';
  if (change.kind === 'regression') return 'warning';
  return 'info';
}

export function diffChecks(before, after) {
  const old = new Map((before ?? []).map((check) => [check.id, check]));
  const now = new Map((after ?? []).map((check) => [check.id, check]));
  const changes = [];

  for (const [id, check] of now) {
    const previous = old.get(id);
    if (!previous) {
      changes.push({ id, kind: 'new', title: check.title, detail: 'This check did not run on the baseline, so it is not a regression.' });
      continue;
    }
    if (previous.status === 'pass' && check.status !== 'pass') {
      changes.push({ id, kind: 'regression', title: check.title, before: previous.status, after: check.status, detail: check.detail });
      continue;
    }
    if (previous.status !== 'pass' && check.status === 'pass') {
      changes.push({ id, kind: 'fixed', title: check.title, before: previous.status, after: check.status, detail: check.detail });
      continue;
    }
    if (previous.status !== check.status) {
      changes.push({ id, kind: 'changed', title: check.title, before: previous.status, after: check.status, detail: check.detail });
      continue;
    }
    if ((previous.detail ?? '') !== (check.detail ?? '')) {
      changes.push({ id, kind: 'wording', title: check.title, detail: check.detail });
    }
  }

  for (const [id, check] of old) {
    if (now.has(id)) continue;
    changes.push({ id, kind: 'dropped', title: check.title, detail: 'This check no longer runs. That is a methodology change, not a fix.' });
  }

  return changes.map((change) => ({ ...change, severity: severityOf(change) }));
}

export function highestSeverity(changes) {
  return changes.reduce((worst, change) => (CRITICAL_ORDER.indexOf(change.severity) > CRITICAL_ORDER.indexOf(worst) ? change.severity : worst), 'none');
}

export function shouldFail(changes, failOn) {
  if (failOn === 'never') return false;
  const worst = highestSeverity(changes);
  if (failOn === 'warning') return worst === 'warning' || worst === 'critical';
  return worst === 'critical';
}

export function renderComment({ hostname, url, changes, baseline, failed }) {
  const regressions = changes.filter((change) => change.kind === 'regression');
  const fixed = changes.filter((change) => change.kind === 'fixed');
  const critical = regressions.filter((change) => change.severity === 'critical');
  const lines = [];
  lines.push('<!-- crawlwise-report -->');
  lines.push('## crawlwise audit — ' + hostname);
  lines.push('');
  lines.push(
    (failed ? '**This build failed.** ' : '') +
      (regressions.length ? regressions.length + (regressions.length === 1 ? ' regression' : ' regressions') : 'No regressions') +
      ' · ' +
      (fixed.length ? fixed.length + ' fixed' : 'nothing fixed') +
      ' · ' +
      changes.length +
      ' checks compared',
  );
  lines.push('');
  lines.push('Audited ' + url);
  if (baseline) lines.push('Compared against ' + baseline);
  lines.push('');

  const section = (title, list, render) => {
    if (!list.length) return;
    lines.push('### ' + title + ' (' + list.length + ')');
    lines.push('');
    lines.push('| Check | Before | After | Evidence |');
    lines.push('| --- | --- | --- | --- |');
    for (const change of list) lines.push(render(change));
    lines.push('');
  };

  section('Regressions', regressions, (change) =>
    '| ' + cells([change.severity.toUpperCase() + ' · ' + change.title, change.before ?? '—', change.after ?? '—', change.detail ?? '']));
  section('Fixed', fixed, (change) => '| ' + cells([change.title, change.before ?? '—', change.after ?? '—', change.detail ?? '']));

  const other = changes.filter((change) => !['regression', 'fixed'].includes(change.kind));
  if (other.length) {
    lines.push('<details><summary>' + other.length + ' other changes</summary>');
    lines.push('');
    for (const change of other) lines.push('- **' + change.kind + '** · ' + change.title + ' — ' + (change.detail ?? ''));
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  if (critical.length) {
    lines.push('A critical regression is a page that has left the index or left an AI crawler’s reach. Fix it or the build stays red.');
    lines.push('');
  }
  lines.push('Free tools and the limits of this audit: ' + 'https://crawlwise.site/limits');
  return lines.join('\n');
}

function cells(values) {
  return values.map((value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').slice(0, 200)).join(' | ') + ' |';
}

export function baselineFromRuns(runs, url) {
  const match = (runs ?? []).find((run) => run.url === url && run.id);
  return match ? match.id : null;
}

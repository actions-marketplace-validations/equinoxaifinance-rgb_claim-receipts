import { COMMENT_MARKER } from './github.mjs';

const ICON = { verified: '✅', contradicted: '❌', unproven: '⚠️', pending: '⏳', warning: '🟡' };
const LABEL = { verified: 'Proven', contradicted: 'Contradicted', unproven: 'No proof', pending: 'Still running', warning: 'Check this' };
const ORDER = ['contradicted', 'unproven', 'warning', 'pending', 'verified'];

function cell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function headline(counts) {
  if (counts.contradicted) return `❌ ${counts.contradicted} claim${counts.contradicted === 1 ? '' : 's'} contradicted by the evidence`;
  if (counts.unproven) return `⚠️ ${counts.unproven} claim${counts.unproven === 1 ? '' : 's'} with no proof`;
  if (counts.warning) return `🟡 ${counts.warning} thing${counts.warning === 1 ? '' : 's'} worth a second look`;
  if (counts.pending) return '⏳ Waiting on checks that are still running';
  if (counts.verified) return `✅ All ${counts.verified} checkable claim${counts.verified === 1 ? '' : 's'} proven`;
  return 'No checkable claims found';
}

export function renderMarkdown(result, { includeMarker = true } = {}) {
  const { receipts, counts, pr } = result;
  const lines = [];
  if (includeMarker) lines.push(COMMENT_MARKER);
  lines.push(`### Claim Receipts: ${headline(counts)}`, '');
  if (!receipts.length) {
    lines.push(
      'This description makes no claims that can be checked automatically (test results, linked issues, files, functions or new packages).',
      '',
    );
  } else {
    lines.push('| | Claim | Evidence |', '|---|---|---|');
    const sorted = [...receipts].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict));
    for (const r of sorted) lines.push(`| ${ICON[r.verdict]} ${LABEL[r.verdict]} | ${cell(r.claim)} | ${cell(r.evidence)} |`);
    lines.push('');
  }
  lines.push(`<sub>Checked commit ${pr.sha.slice(0, 7)}. Every verdict comes from GitHub and package-registry data, not from an AI's opinion. Edit the description and re-run to update.</sub>`);
  return lines.join('\n');
}

export function toJson(result) {
  return JSON.stringify({ pr: result.pr, counts: result.counts, receipts: result.receipts }, null, 2);
}

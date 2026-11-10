#!/usr/bin/env node
/**
 * Progress report for a running scrape log, in the fixed reporting format:
 * % done, % left, ETA + wall-clock finish, per-post bars, measured rate.
 *
 * Usage: node scripts/scrape-progress.js <logfile> [minedPost...]
 */
const fs = require('fs');
const [logPath, ...minedArgs] = process.argv.slice(2);
if (!logPath) { console.error('usage: scrape-progress.js <logfile> [postNum...]'); process.exit(1); }

const raw = fs.readFileSync(logPath, 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
const lines = raw.split('\n');
const MINED = (minedArgs.length ? minedArgs.map(Number) : [8, 12, 16]);

const ts = (l) => {
  const m = l.match(/^\[(\d\d):(\d\d):(\d\d)\./);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
};

const starts = {};
let cur = null;
const eng = {};
const idxOf = {};
lines.forEach((l, i) => {
  const m = l.match(/Post (\d+)\/\d+/);
  if (m) { cur = +m[1]; if (ts(l) && !(cur in starts)) starts[cur] = ts(l); idxOf[cur] = i; }
  const e = l.match(/(\d+) engagers — qualifying/);
  if (e && cur) eng[cur] = +e[1];
});

const stamped = lines.filter(ts);
const now = ts(stamped[stamped.length - 1]);
const first = starts[MINED[0]] ?? now;
const elapsed = Math.max(1, now - first);

const countIn = (txt) => (txt.match(/(?:Scraped|Cached):/g) || []).length;
const processed = countIn(raw);

// per-post processed counts
const perPost = {};
for (const p of MINED) {
  if (!(p in idxOf)) { perPost[p] = 0; continue; }
  const nextIdx = MINED.filter(q => q > p && q in idxOf).map(q => idxOf[q])[0] ?? lines.length;
  perPost[p] = countIn(lines.slice(idxOf[p], nextIdx).join('\n'));
}

const DEFAULT_EST = 199;
const totalEst = MINED.reduce((a, p) => a + (eng[p] ?? DEFAULT_EST), 0);
const pct = Math.min(100, 100 * processed / totalEst);
const rate = elapsed / Math.max(1, processed);
const remain = Math.max(0, totalEst - processed);
const eta = remain * rate;
const fin = new Date(Date.now() + eta * 1000);
const mmss = (s) => `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;

const bar = (done, tot, w = 20) => {
  const f = tot ? Math.min(1, done / tot) : 0;
  const full = Math.floor(f * w);
  return '█'.repeat(full) + '░'.repeat(w - full);
};

const curPost = MINED.filter(p => p in idxOf).pop();
const pos = MINED.indexOf(curPost) + 1;
const curTot = eng[curPost];
const isDone = remain === 0;

console.log(isDone
  ? `## 100% done · 0% left · finished`
  : `## ${pct.toFixed(1)}% done · ${(100 - pct).toFixed(1)}% left · ETA ~${Math.round(eta / 60)} min (finish ~${fin.toTimeString().slice(0, 5)})`);
console.log();
console.log(`**Post #${curPost} of ${MINED.length}** (${pos} of ${MINED.length}) — ${perPost[curPost]} of ${curTot ?? '?'} engagers processed.`);
console.log();
console.log('```');
for (const p of MINED) {
  const tot = eng[p] ?? DEFAULT_EST;
  const d = perPost[p] ?? 0;
  const state = !(p in idxOf) ? 'queued' : (p !== curPost || isDone) ? 'done' : `${Math.round(100 * d / tot)}%`;
  const totLbl = (p in eng) ? tot : `~${tot}`;
  console.log(`Post ${String(p).padStart(2)}  ${bar(d, tot)}  ${String(d).padStart(3)}/${String(totLbl).padEnd(5)} ${state}`);
}
console.log('─'.repeat(45));
console.log(`OVERALL  ${bar(processed, totalEst)}  ${processed}/~${totalEst}  ${pct.toFixed(1)}%`);
console.log('```');
console.log();
console.log('| | |');
console.log('|---|---|');
console.log(`| Elapsed | ${mmss(elapsed)} |`);
console.log(`| Rate | ${rate.toFixed(2)}s per engager |`);
console.log(`| Remaining | ~${remain} engagers |`);
console.log(`| **ETA** | **${isDone ? 'complete' : `~${Math.round(eta / 60)} min → finishes ~${fin.toTimeString().slice(0, 5)}`}** |`);
console.log(`| Pending leads | ${(raw.match(/PENDING LEAD/g) || []).length} |`);
console.log(`| Rejected | ${(raw.match(/REJECTED/g) || []).length} |`);

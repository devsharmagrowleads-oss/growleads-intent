// Console logger for the CLI. (Was an SSE broadcaster when this ran as a web
// service; the dashboard is gone, so it just prints now.) The API is unchanged
// so every caller keeps working.

const COLOR = { INFO: '', OK: '\x1b[32m', WARN: '\x1b[33m', ERROR: '\x1b[31m' };
const RESET = '\x1b[0m';

function log(level, msg) {
  const time = new Date().toISOString().substr(11, 12);
  const c = COLOR[level] || '';
  const stream = level === 'ERROR' ? process.stderr : process.stdout;
  stream.write(`${c}[${time}] [${level}] ${msg}${RESET}\n`);
}

module.exports = {
  info:  (msg) => log('INFO', msg),
  warn:  (msg) => log('WARN', msg),
  error: (msg) => log('ERROR', msg),
  ok:    (msg) => log('OK', msg),
  // No-op kept so any lingering caller doesn't crash. There is no SSE anymore.
  addClient: () => {},
};

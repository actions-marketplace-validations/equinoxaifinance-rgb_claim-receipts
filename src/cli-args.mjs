// Argument parsing for the command-line tool, kept apart so tests can import it.

export function parseTarget(arg) {
  if (!arg) return null;
  const url = arg.match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/);
  if (url) return { repo: url[1], number: Number(url[2]) };
  const short = arg.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  if (short) return { repo: short[1], number: Number(short[2]) };
  return null;
}

export function parseArgs(argv) {
  const opts = { json: false, failOn: 'contradicted', wait: 0, testChecks: undefined, help: false, target: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--fail-on') opts.failOn = argv[++i];
    else if (a === '--wait') opts.wait = Number(argv[++i]) || 0;
    else if (a === '--test-checks') opts.testChecks = argv[++i];
    else opts.target = parseTarget(a);
  }
  return opts;
}

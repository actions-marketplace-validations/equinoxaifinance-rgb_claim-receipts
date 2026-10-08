// Entry file the action runs. Kept separate so importing main.mjs never starts a run.
import { run } from './main.mjs';

run().then(({ exitCode }) => { process.exitCode = exitCode; }, (err) => {
  console.log(`::error::Claim Receipts failed to run: ${err.message}`);
  process.exitCode = 1;
});

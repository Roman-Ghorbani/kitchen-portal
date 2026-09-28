/**
 * Loads .env.production (or .env.local) into process.env for the operational
 * scripts, without overriding anything already set - so a systemd
 * EnvironmentFile, or a variable on the command line, always wins.
 *
 * A tiny parser rather than a dependency or `node --env-file`, which the
 * Pi's Node 20 does not support in its `-if-exists` form.
 */

import { existsSync, readFileSync } from 'node:fs';

for (const file of ['.env.production', '.env.local']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
  break;
}

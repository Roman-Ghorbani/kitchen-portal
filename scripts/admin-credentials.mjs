#!/usr/bin/env node
/**
 * Generates the kitchen manager's credentials for the environment file.
 *
 *   npm run admin:credentials
 *
 * Prompts for a password (typed twice, not echoed), then prints:
 *
 *   ADMIN_PASSWORD_HASH  scrypt hash of the password - the plaintext is never stored
 *   ADMIN_TOTP_SECRET    a new base-32 secret for an authenticator app
 *
 * and an otpauth:// URI plus the secret in groups, for adding the account to
 * Google Authenticator, 1Password, Authy or similar. Paste the two lines into
 * .env.production on the Pi, remove ADMIN_PASSWORD, and restart the service.
 *
 * Pass --no-totp to generate only the password hash.
 */

import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline';

const MIN_LENGTH = 12;

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Mute the echo while the password is typed.
    rl._writeToOutput = (s) => {
      if (s.includes(question)) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

function base32(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

const password = await ask('New kitchen manager password: ');
if (password.length < MIN_LENGTH) {
  console.error(`Use at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}
if ((await ask('Type it again: ')) !== password) {
  console.error('The two entries did not match.');
  process.exit(1);
}

// Must match hashSecret() in src/lib/auth.ts.
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32, { N: 16384 });
console.log('\nAdd to .env.production (and delete ADMIN_PASSWORD):\n');
console.log(`ADMIN_PASSWORD_HASH=scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`);

if (!process.argv.includes('--no-totp')) {
  const secret = base32(randomBytes(20));
  const issuer = encodeURIComponent('Kitchen Portal');
  console.log(`ADMIN_TOTP_SECRET=${secret}`);
  console.log('\nAdd this account to your authenticator app, by URI:');
  console.log(`  otpauth://totp/${issuer}:manager?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`);
  console.log('or by typing the key:');
  console.log(`  ${secret.match(/.{1,4}/g).join(' ')}`);
}
console.log('\nThen restart the service. Every existing manager session ends.');

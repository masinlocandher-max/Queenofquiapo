// Sets the organizer's first password without any ChatGPT account.
//
//   node scripts/organizer-password.mjs organizer@example.com
//
// Type the password when asked (it is not shown). The script prints one SQL statement containing only a salted
// PBKDF2 hash. Run that statement in the Supabase SQL editor of the production project. The plain password is never
// printed, stored or sent anywhere. Running it again replaces the password and signs out any existing sessions.
import {webcrypto as crypto} from 'node:crypto';
import {createInterface} from 'node:readline';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('Usage: node scripts/organizer-password.mjs organizer@example.com'); process.exit(2); }
const b64url = bytes => Buffer.from(bytes).toString('base64url');

async function ask(question) {
  if (!process.stdin.isTTY) { let text = ''; for await (const chunk of process.stdin) text += chunk; return text.replace(/\r?\n$/, ''); }
  const rl = createInterface({input: process.stdin, output: process.stdout, terminal: true});
  rl._writeToOutput = text => { if (text.includes(question)) process.stdout.write(text); };   // do not echo the password
  const answer = await new Promise(resolve => rl.question(question, resolve)); rl.close(); process.stdout.write('\n'); return answer;
}
const password = await ask('New organizer password (12+ characters): ');
if (password.length < 12 || password.length > 200) { console.error('Use at least 12 characters.'); process.exit(1); }
if (process.stdin.isTTY && (await ask('Type it again: ')) !== password) { console.error('The two entries differ.'); process.exit(1); }
// Same format and parameters as server/access.mjs.
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const hash = new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000}, key, 256));
const stored = 'pbkdf2-sha256$100000$' + b64url(salt) + '$' + b64url(hash);
console.log(`insert into qoq_private.credentials(email,role,secret_hash) values ('${email.replaceAll("'", "''")}','organizer','${stored}')
  on conflict (email,role) do update set secret_hash=excluded.secret_hash, version=qoq_private.credentials.version+1, failed=0, locked_until=null, updated_at=now();`);

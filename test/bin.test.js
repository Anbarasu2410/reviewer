'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { createTempRepo, commitFiles, cleanup } = require('./helpers/repo');

/**
 * Smoke tests for the `reviewer` command itself.
 *
 * The unit tests cover argument parsing without loading this file, so nothing
 * else would notice if the entry point stopped starting — a syntax error in it
 * once slipped through exactly that gap.
 */

const BIN = path.join(__dirname, '..', 'bin', 'reviewer.js');

/**
 * Run the command and capture how it exited.
 *
 * @param {string[]} args
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function run(args) {
  return new Promise(resolve => {
    execFile(process.execPath, [BIN, ...args], { timeout: 20000 }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

test('--help prints usage and exits cleanly', async () => {
  const { code, stdout } = await run(['--help']);

  assert.equal(code, 0);
  assert.match(stdout, /Usage:\s+reviewer/);
  assert.match(stdout, /--no-open/);
});

test('--version prints the version from package.json', async () => {
  const { version } = require('../package.json');
  const { code, stdout } = await run(['--version']);

  assert.equal(code, 0);
  assert.equal(stdout.trim(), version);
});

test('an unknown option exits 2 with usage on stderr', async () => {
  const { code, stderr } = await run(['--frobnicate']);

  assert.equal(code, 2);
  assert.match(stderr, /Unknown option: --frobnicate/);
  assert.match(stderr, /Usage:/);
});

test('a bad port exits 2', async () => {
  const { code, stderr } = await run(['--port', 'abc']);

  assert.equal(code, 2);
  assert.match(stderr, /must be a number/);
});

test('a repository path that does not exist exits 2', async () => {
  const { code, stderr } = await run([path.join('/no', 'such', 'directory'), '--no-open']);

  assert.equal(code, 2);
  assert.match(stderr, /No such directory/);
});

test('export refuses when the repository has no saved review', async t => {
  const repoPath = await createTempRepo();
  t.after(() => cleanup(repoPath));

  const { code, stderr } = await run(['export', repoPath]);

  assert.equal(code, 2);
  assert.match(stderr, /No saved review/);
});

test('it serves the repository it was pointed at, then stops on SIGINT', async t => {
  const repoPath = await createTempRepo();
  t.after(() => cleanup(repoPath));

  await commitFiles(repoPath, { 'app.js': 'a\n' }, 'initial');

  // Port 0 keeps concurrent test runs from colliding.
  const child = require('node:child_process').spawn(
    process.execPath,
    [BIN, repoPath, '--no-open', '--port', '0'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  t.after(() => child.kill('SIGKILL'));

  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`no URL in output: ${output}`)), 15000);

    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\S*/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.on('error', reject);
  });

  // The URL carries the repository, so the page loads it without being typed.
  assert.equal(new URL(url).searchParams.get('repo'), repoPath);

  const health = await fetch(`${new URL(url).origin}/api/health`);
  assert.equal(health.status, 200);

  const exited = new Promise(resolve => child.on('exit', resolve));
  child.kill('SIGINT');
  await exited;
});

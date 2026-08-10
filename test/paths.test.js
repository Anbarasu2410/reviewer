'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveRepoFile, PathEscapeError } = require('../lib/paths');

const REPO = path.resolve('/tmp/repo');

test('resolveRepoFile resolves a path inside the repository', () => {
  assert.equal(resolveRepoFile(REPO, 'src/app.js'), path.join(REPO, 'src', 'app.js'));
});

test('resolveRepoFile normalizes traversal that stays inside', () => {
  assert.equal(resolveRepoFile(REPO, 'src/../lib/x.js'), path.join(REPO, 'lib', 'x.js'));
});

test('resolveRepoFile refuses traversal above the repository', () => {
  assert.throws(() => resolveRepoFile(REPO, '../../etc/passwd'), PathEscapeError);
  assert.throws(() => resolveRepoFile(REPO, 'src/../../../etc/passwd'), PathEscapeError);
});

test('resolveRepoFile refuses an absolute path', () => {
  assert.throws(() => resolveRepoFile(REPO, '/etc/passwd'), PathEscapeError);
});

test('resolveRepoFile refuses a sibling directory sharing the prefix', () => {
  // A prefix comparison would accept `/tmp/repo-evil`; a relative-path check
  // does not.
  assert.throws(() => resolveRepoFile(REPO, '../repo-evil/secret'), PathEscapeError);
});

test('resolveRepoFile refuses the repository root itself', () => {
  assert.throws(() => resolveRepoFile(REPO, '.'), PathEscapeError);
  assert.throws(() => resolveRepoFile(REPO, ''), PathEscapeError);
});

test('resolveRepoFile refuses a missing path', () => {
  assert.throws(() => resolveRepoFile(REPO, undefined), PathEscapeError);
  assert.throws(() => resolveRepoFile(REPO, null), PathEscapeError);
});

test('PathEscapeError carries the offending path', () => {
  try {
    resolveRepoFile(REPO, '../../etc/passwd');
    assert.fail('expected a PathEscapeError');
  } catch (error) {
    assert.ok(error instanceof PathEscapeError);
    assert.equal(error.requested, '../../etc/passwd');
  }
});

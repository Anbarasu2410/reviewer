'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseDiff, wholeFileAsAdditions } = require('../lib/diff');

test('parseDiff numbers lines from the hunk header', () => {
  const diff = [
    '--- a/app.js',
    '+++ b/app.js',
    '@@ -10,3 +10,4 @@',
    ' const a = 1;',
    '-const b = 2;',
    '+const b = 3;',
    '+const c = 4;',
    ' module.exports = { a };'
  ].join('\n');

  assert.deepEqual(parseDiff(diff, ''), [
    { oldLine: 10, newLine: 10, type: 'unchanged', content: 'const a = 1;' },
    { oldLine: 11, newLine: null, type: 'delete', content: 'const b = 2;' },
    { oldLine: null, newLine: 11, type: 'add', content: 'const b = 3;' },
    { oldLine: null, newLine: 12, type: 'add', content: 'const c = 4;' },
    { oldLine: 12, newLine: 13, type: 'unchanged', content: 'module.exports = { a };' }
  ]);
});

test('parseDiff accepts a hunk header without line counts', () => {
  const diff = ['@@ -1 +1 @@', '-old', '+new'].join('\n');

  assert.deepEqual(parseDiff(diff, ''), [
    { oldLine: 1, newLine: null, type: 'delete', content: 'old' },
    { oldLine: null, newLine: 1, type: 'add', content: 'new' }
  ]);
});

test('parseDiff ignores everything before the first hunk', () => {
  const diff = [
    'diff --git a/app.js b/app.js',
    'index 83db48f..bf269f4 100644',
    '--- a/app.js',
    '+++ b/app.js',
    '@@ -1,1 +1,1 @@',
    '+only this'
  ].join('\n');

  assert.deepEqual(parseDiff(diff, ''), [
    { oldLine: null, newLine: 1, type: 'add', content: 'only this' }
  ]);
});

test('parseDiff does not read a second file header as content', () => {
  // A caller that forgets to scope the diff to one path gets multi-file text.
  // The `---`/`+++` lines of the second file must not become delete/add lines.
  const diff = [
    'diff --git a/one.js b/one.js',
    '--- a/one.js',
    '+++ b/one.js',
    '@@ -1,1 +1,1 @@',
    '+first',
    'diff --git a/two.js b/two.js',
    '--- a/two.js',
    '+++ b/two.js',
    '@@ -1,1 +1,1 @@',
    '+second'
  ].join('\n');

  const contents = parseDiff(diff, '').map(line => line.content);
  assert.deepEqual(contents, ['first', 'second']);
});

test('parseDiff drops the no-newline marker', () => {
  const diff = ['@@ -1,1 +1,1 @@', '-old', '\\ No newline at end of file', '+new'].join('\n');

  assert.deepEqual(parseDiff(diff, '').map(line => line.content), ['old', 'new']);
});

test('parseDiff treats a file with no diff as wholly added', () => {
  assert.deepEqual(parseDiff('', 'a\nb'), [
    { oldLine: null, newLine: 1, type: 'add', content: 'a' },
    { oldLine: null, newLine: 2, type: 'add', content: 'b' }
  ]);
});

test('parseDiff returns nothing for an empty file with no diff', () => {
  assert.deepEqual(parseDiff('', ''), []);
});

test('parseDiff tolerates missing arguments', () => {
  assert.deepEqual(parseDiff(undefined, undefined), []);
  assert.deepEqual(parseDiff(null, null), []);
});

test('parseDiff keeps blank lines inside a hunk', () => {
  const diff = ['@@ -1,2 +1,2 @@', ' ', '+'].join('\n');

  assert.deepEqual(parseDiff(diff, ''), [
    { oldLine: 1, newLine: 1, type: 'unchanged', content: '' },
    { oldLine: null, newLine: 2, type: 'add', content: '' }
  ]);
});

test('parseDiff resumes numbering across multiple hunks', () => {
  const diff = ['@@ -1,1 +1,1 @@', '+top', '@@ -50,1 +60,1 @@', '+bottom'].join('\n');

  assert.deepEqual(parseDiff(diff, '').map(line => line.newLine), [1, 60]);
});

test('wholeFileAsAdditions numbers every line from one', () => {
  assert.deepEqual(wholeFileAsAdditions('x\ny\nz').map(line => line.newLine), [1, 2, 3]);
});

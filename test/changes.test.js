'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { collectWorkingChanges, collectCommitChanges, classifyCommitFile } = require('../lib/changes');

test('collectWorkingChanges labels each bucket', () => {
  const changes = collectWorkingChanges({
    modified: ['edited.js'],
    created: ['staged.js'],
    not_added: ['untracked.js'],
    deleted: ['gone.js'],
    renamed: [{ from: 'old.js', to: 'new.js' }]
  });

  assert.deepEqual(changes, [
    { path: 'new.js', status: 'R' },
    { path: 'gone.js', status: 'D' },
    { path: 'staged.js', status: 'A' },
    { path: 'untracked.js', status: 'A' },
    { path: 'edited.js', status: 'M' }
  ]);
});

test('collectWorkingChanges reports a deleted file', () => {
  // Deletions used to be dropped entirely, so a review could not comment on
  // a removed file.
  const changes = collectWorkingChanges({ deleted: ['gone.js'] });

  assert.deepEqual(changes, [{ path: 'gone.js', status: 'D' }]);
});

test('collectWorkingChanges lists a path once when several buckets claim it', () => {
  // A file staged and then edited again is both created and modified.
  const changes = collectWorkingChanges({
    created: ['both.js'],
    modified: ['both.js']
  });

  assert.deepEqual(changes, [{ path: 'both.js', status: 'A' }]);
});

test('collectWorkingChanges handles a clean tree', () => {
  assert.deepEqual(collectWorkingChanges({}), []);
  assert.deepEqual(collectWorkingChanges(undefined), []);
});

test('classifyCommitFile reads insertion and deletion counts', () => {
  assert.equal(classifyCommitFile({ insertions: 5, deletions: 2 }), 'M');
  assert.equal(classifyCommitFile({ insertions: 5, deletions: 0 }), 'A');
  assert.equal(classifyCommitFile({ insertions: 0, deletions: 5 }), 'D');
});

test('classifyCommitFile marks a binary file before counting lines', () => {
  assert.equal(classifyCommitFile({ binary: true, insertions: 0, deletions: 0 }), 'B');
});

test('classifyCommitFile falls back to modified when counts say nothing', () => {
  assert.equal(classifyCommitFile({ insertions: 0, deletions: 0 }), 'M');
  assert.equal(classifyCommitFile({}), 'M');
});

test('collectCommitChanges maps a diff summary', () => {
  const changes = collectCommitChanges({
    files: [
      { file: 'a.js', insertions: 3, deletions: 1 },
      { file: 'logo.png', binary: true }
    ]
  });

  assert.deepEqual(changes, [
    { path: 'a.js', status: 'M' },
    { path: 'logo.png', status: 'B' }
  ]);
});

test('collectCommitChanges handles an empty summary', () => {
  assert.deepEqual(collectCommitChanges({}), []);
  assert.deepEqual(collectCommitChanges(undefined), []);
});

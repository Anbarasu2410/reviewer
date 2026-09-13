'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeComment, normalizeComments, groupByFile } = require('../lib/comments');

test('normalizeComment keeps only the persisted fields', () => {
  const normalized = normalizeComment({
    file: 'app.js',
    line: 12,
    lineContent: 'const a = 1;',
    text: 'rename this',
    id: 'client-only',
    collapsed: true
  });

  assert.deepEqual(normalized, {
    file: 'app.js',
    line: 12,
    lineContent: 'const a = 1;',
    text: 'rename this'
  });
});

test('normalizeComment omits an empty selection rather than storing null', () => {
  for (const selectedText of [null, undefined, '']) {
    const normalized = normalizeComment({ file: 'a.js', line: 1, text: 'x', selectedText });
    assert.ok(!('selectedText' in normalized), `expected no selectedText for ${selectedText}`);
  }
});

test('normalizeComment keeps a non-empty selection', () => {
  const normalized = normalizeComment({
    file: 'a.js',
    line: 1,
    text: 'x',
    selectedText: 'const a = 1;'
  });

  assert.equal(normalized.selectedText, 'const a = 1;');
});

test('normalizeComment omits an empty follow-up list', () => {
  assert.ok(!('followUps' in normalizeComment({ file: 'a.js', line: 1, text: 'x', followUps: [] })));
  assert.ok(!('followUps' in normalizeComment({ file: 'a.js', line: 1, text: 'x' })));
});

test('normalizeComment reduces follow-ups to text and timestamp', () => {
  const normalized = normalizeComment({
    file: 'a.js',
    line: 1,
    text: 'x',
    followUps: [
      { text: 'first', timestamp: '2026-01-01T00:00:00.000Z', id: 9 },
      { text: 'second' }
    ]
  });

  assert.deepEqual(normalized.followUps, [
    { text: 'first', timestamp: '2026-01-01T00:00:00.000Z' },
    { text: 'second' }
  ]);
});

test('normalizeComments rejects a non-array', () => {
  assert.throws(() => normalizeComments(undefined), TypeError);
  assert.throws(() => normalizeComments({ file: 'a.js' }), TypeError);
});

test('normalizeComments rejects a comment with no file or text instead of storing undefined', () => {
  // Posting another shape (e.g. filePath/body) used to be saved as { line } and
  // exported as a comment on a file called "undefined".
  assert.throws(
    () => normalizeComments([{ filePath: 'f.txt', line: 2, body: 'hello' }]),
    { name: 'TypeError', message: 'comments[0].file must be a non-empty string' }
  );
  assert.throws(() => normalizeComments([{}]), TypeError);
});

test('normalizeComments names the malformed field and its index', () => {
  const valid = { file: 'a.js', line: 1, text: 'ok' };
  const cases = [
    [null, 'comments[1] must be an object'],
    [[], 'comments[1] must be an object'],
    [{ ...valid, file: '   ' }, 'comments[1].file must be a non-empty string'],
    [{ ...valid, line: 0 }, 'comments[1].line must be a positive integer'],
    [{ ...valid, line: '3' }, 'comments[1].line must be a positive integer'],
    [{ ...valid, line: 1.5 }, 'comments[1].line must be a positive integer'],
    [{ ...valid, text: '' }, 'comments[1].text must be a non-empty string'],
    [{ file: 'a.js', line: 1 }, 'comments[1].text must be a non-empty string']
  ];
  for (const [comment, message] of cases) {
    assert.throws(() => normalizeComments([valid, comment]), { name: 'TypeError', message });
  }
});

test('normalizeComments accepts an empty list', () => {
  assert.deepEqual(normalizeComments([]), []);
});

test('groupByFile sorts each file by line number', () => {
  const grouped = groupByFile([
    { file: 'a.js', line: 30, text: 'third' },
    { file: 'a.js', line: 10, text: 'first' },
    { file: 'a.js', line: 20, text: 'second' }
  ]);

  assert.deepEqual(grouped[0][1].map(comment => comment.text), ['first', 'second', 'third']);
});

test('groupByFile preserves the order files were first commented on', () => {
  const grouped = groupByFile([
    { file: 'z.js', line: 1, text: 'a' },
    { file: 'a.js', line: 1, text: 'b' },
    { file: 'z.js', line: 2, text: 'c' }
  ]);

  assert.deepEqual(grouped.map(([file]) => file), ['z.js', 'a.js']);
});

test('groupByFile does not mutate its input', () => {
  const comments = [
    { file: 'a.js', line: 30, text: 'third' },
    { file: 'a.js', line: 10, text: 'first' }
  ];

  groupByFile(comments);

  assert.deepEqual(comments.map(comment => comment.line), [30, 10]);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * The README carries a hand-maintained test-count badge, and a hand-maintained
 * number in a published artifact goes stale. It already has: the most recent
 * commit on `main` before this one exists solely to correct it after #13.
 *
 * The count here is of `test(...)` declarations, which is what a reader of the
 * badge means by "tests". Note that `node --test` reports one *more* than this,
 * because it treats every `.js` file under `test/` as a test file and scores
 * `test/helpers/repo.js` — a helper with no assertions in it — as a passing
 * test. Copying that number into the badge would advertise a test that does not
 * exist, so the badge tracks declarations and this test explains the gap rather
 * than encoding it.
 */

const TEST_DIR = __dirname;
const README = path.join(__dirname, '..', 'README.md');

/**
 * Count the tests declared across the suite.
 *
 * Declarations start a line, which is the house style throughout `test/`. A
 * declaration written some other way is undercounted and this test fails —
 * noisily, and in the direction that gets looked at, rather than silently
 * blessing a wrong badge.
 *
 * @returns {number}
 */
function countDeclaredTests() {
  return fs
    .readdirSync(TEST_DIR)
    .filter(entry => entry.endsWith('.test.js'))
    .reduce((total, entry) => {
      const source = fs.readFileSync(path.join(TEST_DIR, entry), 'utf-8');
      return total + (source.match(/^test\(/gm)?.length ?? 0);
    }, 0);
}

/**
 * Every place the README states the test count.
 *
 * The badge was guarded from #18; the Development block's `npm test` comment
 * was not, and went stale by 13 while the guarded number stayed right (#21).
 * A count that lives in two places needs both of them checked, so new sites
 * get added here rather than left to drift until someone reads them.
 */
const COUNT_SITES = [
  { what: 'the tests badge (line 6)', pattern: /badge\/tests-(\d+)-/ },
  {
    what: "the Development block's `npm test` comment",
    pattern: /npm test\s+#\s*(\d+) tests/
  }
];

test('every README test count matches the suite', () => {
  const readme = fs.readFileSync(README, 'utf-8');
  const declared = countDeclaredTests();

  for (const { what, pattern } of COUNT_SITES) {
    const found = readme.match(pattern);

    assert.ok(found, `README no longer states the test count in ${what}`);
    assert.equal(
      Number(found[1]),
      declared,
      `README says ${found[1]} tests in ${what}, the suite declares ${declared}. ` +
        'Update it in README.md to match. Use this number, not the count ' +
        '`node --test` prints — that one is one higher, because it counts ' +
        'test/helpers/repo.js as a test.'
    );
  }
});

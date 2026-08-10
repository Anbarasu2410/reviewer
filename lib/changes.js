'use strict';

/**
 * Turning git state into the flat `{ path, status }` list the file sidebar
 * renders.
 *
 * Status letters follow git's own vocabulary: `A` added, `M` modified,
 * `D` deleted, `R` renamed, `B` binary.
 */

/**
 * @typedef {object} ChangedFile
 * @property {string} path repo-relative path
 * @property {'A'|'M'|'D'|'R'|'B'} status
 */

/**
 * Collect working-directory changes from a `simple-git` status result.
 *
 * A single path can be reported by more than one bucket — a file that is
 * staged and then edited again shows up as both created and modified — so the
 * first status wins and later duplicates are dropped. Buckets are ordered
 * most- to least-specific for that reason.
 *
 * @param {import('simple-git').StatusResult} status
 * @returns {ChangedFile[]}
 */
function collectWorkingChanges(status) {
  const buckets = [
    [status?.renamed ?? [], 'R'],
    [status?.deleted ?? [], 'D'],
    [status?.created ?? [], 'A'],
    [status?.not_added ?? [], 'A'],
    [status?.modified ?? [], 'M']
  ];

  const seen = new Map();

  for (const [files, letter] of buckets) {
    for (const entry of files) {
      // `renamed` holds `{ from, to }`; every other bucket holds plain strings.
      const filePath = typeof entry === 'string' ? entry : entry?.to;
      if (!filePath || seen.has(filePath)) continue;
      seen.set(filePath, { path: filePath, status: letter });
    }
  }

  return [...seen.values()];
}

/**
 * Derive a status letter for one file of a commit diff summary.
 *
 * `simple-git` reports binary files without insertion/deletion counts, and a
 * commit that only adds lines to a file is an addition of that file only when
 * it deletes none.
 *
 * @param {object} file entry from `git.diffSummary()`
 * @returns {'A'|'M'|'D'|'B'}
 */
function classifyCommitFile(file) {
  if (file?.binary) return 'B';

  const insertions = file?.insertions ?? 0;
  const deletions = file?.deletions ?? 0;

  if (insertions > 0 && deletions > 0) return 'M';
  if (insertions > 0) return 'A';
  if (deletions > 0) return 'D';
  return 'M';
}

/**
 * Collect the files touched by a commit.
 *
 * @param {import('simple-git').DiffResult} diffSummary
 * @returns {ChangedFile[]}
 */
function collectCommitChanges(diffSummary) {
  const files = diffSummary?.files ?? [];
  return files.map(file => ({ path: file.file, status: classifyCommitFile(file) }));
}

module.exports = { collectWorkingChanges, collectCommitChanges, classifyCommitFile };

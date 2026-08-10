'use strict';

/**
 * Parsing of unified diff text into the line model the UI renders.
 *
 * The parser is deliberately tolerant: `git diff` output for a single file is
 * the common case, but the same text can arrive with multiple `diff --git`
 * sections (a caller that forgot to scope the diff to one path), with no hunks
 * at all (an untracked file has nothing to diff against), or truncated.
 */

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * @typedef {object} DiffLine
 * @property {number|null} oldLine  1-based line number before the change
 * @property {number|null} newLine  1-based line number after the change
 * @property {'add'|'delete'|'unchanged'} type
 * @property {string} content       the line without its diff marker
 */

/**
 * Parse unified diff text into structured lines.
 *
 * When the diff contains no hunks the file is treated as wholly new and every
 * line of `currentContent` is reported as an addition — that is what an
 * untracked file looks like to the UI.
 *
 * @param {string} diffText unified diff, may be empty
 * @param {string} currentContent full text of the file as it stands now
 * @returns {DiffLine[]}
 */
function parseDiff(diffText, currentContent) {
  const lines = [];
  const diffLines = String(diffText ?? '').split('\n');

  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of diffLines) {
    // A new file section ends the previous one. Without this the `---`/`+++`
    // headers of the second file would be read as content of the first.
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      continue;
    }

    if (line.startsWith('@@')) {
      const match = line.match(HUNK_HEADER);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
        inHunk = true;
      }
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith('-')) {
      lines.push({ oldLine: oldLine++, newLine: null, type: 'delete', content: line.slice(1) });
    } else if (line.startsWith('+')) {
      lines.push({ oldLine: null, newLine: newLine++, type: 'add', content: line.slice(1) });
    } else if (line.startsWith(' ')) {
      lines.push({ oldLine: oldLine++, newLine: newLine++, type: 'unchanged', content: line.slice(1) });
    }
    // Anything else inside a hunk ("\ No newline at end of file") carries no
    // line of its own and is dropped.
  }

  if (lines.length > 0) return lines;

  return wholeFileAsAdditions(currentContent);
}

/**
 * Represent a file with no diff as one addition per line.
 *
 * @param {string} currentContent
 * @returns {DiffLine[]}
 */
function wholeFileAsAdditions(currentContent) {
  const content = String(currentContent ?? '');
  if (content === '') return [];

  return content
    .split('\n')
    .map((text, i) => ({ oldLine: null, newLine: i + 1, type: 'add', content: text }));
}

module.exports = { parseDiff, wholeFileAsAdditions, HUNK_HEADER };

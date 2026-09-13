'use strict';

/**
 * The stored shape of a review comment.
 *
 * The client keeps extra bookkeeping on each comment (ids, collapsed state,
 * draft text). Only the fields below are written to disk, so a comment file
 * stays readable and stable across UI changes.
 */

/**
 * @typedef {object} FollowUp
 * @property {string} text
 * @property {string} [timestamp] ISO 8601
 */

/**
 * @typedef {object} Comment
 * @property {string} file repo-relative path
 * @property {number} line 1-based line number
 * @property {string} [lineContent] the line the comment is anchored to
 * @property {string} text
 * @property {string} [selectedText] code the reviewer highlighted
 * @property {FollowUp[]} [followUps]
 */

/**
 * Reduce a client comment to the fields that get persisted.
 *
 * Optional fields are omitted rather than stored as `null` so that an absent
 * selection and an empty one are not two different states on disk.
 *
 * A comment missing its file, line or text is rejected here rather than stored:
 * `JSON.stringify` would silently drop the missing fields, and the record would
 * only surface later, in `reviewer export`, as a comment on a file called
 * `undefined` for an agent to act on.
 *
 * @param {object} comment
 * @param {number} index position in the batch, for the error message
 * @returns {Comment}
 * @throws {TypeError} when a required field is missing or malformed
 */
function normalizeComment(comment, index) {
  const where = `comments[${index}]`;
  if (comment === null || typeof comment !== 'object' || Array.isArray(comment)) {
    throw new TypeError(`${where} must be an object`);
  }
  if (typeof comment.file !== 'string' || comment.file.trim() === '') {
    throw new TypeError(`${where}.file must be a non-empty string`);
  }
  if (!Number.isInteger(comment.line) || comment.line < 1) {
    throw new TypeError(`${where}.line must be a positive integer`);
  }
  if (typeof comment.text !== 'string' || comment.text.trim() === '') {
    throw new TypeError(`${where}.text must be a non-empty string`);
  }

  const normalized = {
    file: comment.file,
    line: comment.line,
    lineContent: comment.lineContent,
    text: comment.text
  };

  if (comment.selectedText) {
    normalized.selectedText = comment.selectedText;
  }

  if (Array.isArray(comment.followUps) && comment.followUps.length > 0) {
    normalized.followUps = comment.followUps.map(followUp => {
      const entry = { text: followUp.text };
      if (followUp.timestamp) entry.timestamp = followUp.timestamp;
      return entry;
    });
  }

  return normalized;
}

/**
 * Normalize a batch of comments.
 *
 * @param {object[]} comments
 * @returns {Comment[]}
 * @throws {TypeError} when `comments` is not an array or a comment is malformed
 */
function normalizeComments(comments) {
  if (!Array.isArray(comments)) {
    throw new TypeError('comments must be an array');
  }
  return comments.map((comment, index) => normalizeComment(comment, index));
}

/**
 * Group comments by file, each group sorted by line number.
 *
 * Insertion order of the files is preserved so a review reads in the order the
 * reviewer worked through the changes.
 *
 * @param {Comment[]} comments
 * @returns {Array<[string, Comment[]]>}
 */
function groupByFile(comments) {
  /** @type {Map<string, Comment[]>} */
  const groups = new Map();

  for (const comment of comments) {
    const group = groups.get(comment.file);
    if (group) group.push(comment);
    else groups.set(comment.file, [comment]);
  }

  return [...groups.entries()].map(([file, group]) => [
    file,
    [...group].sort((a, b) => a.line - b.line)
  ]);
}

module.exports = { normalizeComment, normalizeComments, groupByFile };

'use strict';

const path = require('path');

const { groupByFile } = require('./comments');

/**
 * Rendering a set of comments into the Markdown review file, and naming the
 * files that hold a repository's review state.
 */

/**
 * Make a repository name safe to embed in a filename.
 *
 * A repository directory can be named anything the filesystem allows, and that
 * name goes straight into a filename under `reviews/`. Anything outside a
 * conservative set becomes `_` so the result stays a single, predictable path
 * segment.
 *
 * @param {string} repoPath
 * @returns {string}
 */
function repoSlug(repoPath) {
  const base = path.basename(String(repoPath ?? '').replace(/[/\\]+$/, ''));
  const slug = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return slug === '' ? 'repo' : slug;
}

/**
 * Name of the JSON file holding a repository's saved comments.
 *
 * This file is the source of truth for a review: the UI writes it on every
 * edit and the submitted `.txt` is rendered from it.
 *
 * @param {string} repoPath
 * @returns {string}
 */
function commentsFilename(repoPath) {
  return `.code-review-comments-${repoSlug(repoPath)}.json`;
}

/**
 * Name of a submitted review file.
 *
 * The timestamp is derived from the ISO form so the names sort chronologically
 * and contain no characters that need quoting.
 *
 * @param {string} repoPath
 * @param {Date} generatedAt
 * @returns {string}
 */
function reviewFilename(repoPath, generatedAt) {
  const stamp = generatedAt.toISOString().replace(/[:.]/g, '-').replace('T', '_');
  return `review_${repoSlug(repoPath)}_${stamp}.txt`;
}

/**
 * Render comments as the Markdown body of a review.
 *
 * Timestamps are written in ISO 8601 rather than a locale format: a review is
 * a file that gets committed, pasted into a pull request, and read on another
 * machine, so it must not change shape with the reader's locale or timezone.
 *
 * @param {object} args
 * @param {string} args.repoPath repository the review covers
 * @param {import('./comments').Comment[]} args.comments
 * @param {Date} args.generatedAt
 * @returns {string}
 */
function formatReview({ repoPath, comments, generatedAt }) {
  const sections = [
    '# Code Review\n',
    `Repository: ${repoPath}`,
    `Generated: ${generatedAt.toISOString()}`,
    `Total Comments: ${comments.length}\n`
  ];

  for (const [file, fileComments] of groupByFile(comments)) {
    sections.push(`## ${file}\n`);
    for (const comment of fileComments) {
      sections.push(formatComment(comment));
    }
  }

  return `${sections.join('\n')}`;
}

/**
 * @param {import('./comments').Comment} comment
 * @returns {string}
 */
function formatComment(comment) {
  const parts = [`**Line ${comment.line}:**`];

  if (comment.lineContent) {
    parts.push(fence(comment.lineContent));
  }

  if (comment.selectedText) {
    parts.push('**Selected code:**', fence(comment.selectedText));
  }

  parts.push(comment.text);

  if (comment.followUps?.length > 0) {
    parts.push('', '**Follow-ups:**');
    comment.followUps.forEach((followUp, index) => {
      const timestamp = formatTimestamp(followUp.timestamp);
      parts.push(`  ${index + 1}. ${followUp.text}${timestamp ? ` (${timestamp})` : ''}`);
    });
  }

  return `${parts.join('\n')}\n`;
}

/**
 * Wrap text in a fenced code block, widening the fence if the text itself
 * contains one.
 *
 * @param {string} text
 * @returns {string}
 */
function fence(text) {
  const longest = String(text).match(/^`{3,}/gm)?.reduce((a, b) => (b.length > a.length ? b : a), '') ?? '';
  const marker = '`'.repeat(Math.max(3, longest.length + 1));
  return `${marker}\n${text}\n${marker}`;
}

/**
 * @param {string|undefined} timestamp
 * @returns {string} ISO 8601 form, or '' when absent or unparseable
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

module.exports = { formatReview, reviewFilename, commentsFilename, repoSlug };

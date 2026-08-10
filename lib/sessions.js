'use strict';

const crypto = require('crypto');

/**
 * In-memory record of which repository each browser session is reviewing.
 *
 * Sessions live only as long as the process: the desktop app starts a fresh
 * server per launch, and the web mode is a local single-user tool. Nothing
 * here is persisted, so a restart simply asks the user to reopen the repo.
 */

/**
 * @typedef {'working'|'lastCommit'} ReviewMode
 * `working` diffs the working tree against HEAD; `lastCommit` diffs HEAD
 * against its parent, which is what a clean tree falls back to.
 */

class SessionStore {
  /**
   * @param {() => string} [generateId] injectable for deterministic tests
   */
  constructor(generateId = () => crypto.randomBytes(8).toString('hex')) {
    this.generateId = generateId;
    /** @type {Map<string, {repoPath: string, mode: ReviewMode}>} */
    this.sessions = new Map();
  }

  /**
   * @param {string} repoPath absolute path of the opened repository
   * @param {ReviewMode} mode
   * @returns {string} the new session id
   */
  create(repoPath, mode) {
    const repoId = this.generateId();
    this.sessions.set(repoId, { repoPath, mode });
    return repoId;
  }

  /**
   * @param {string} repoId
   * @returns {{repoPath: string, mode: ReviewMode}|undefined}
   */
  get(repoId) {
    return this.sessions.get(repoId);
  }

  /**
   * @param {string} repoId
   * @returns {boolean} whether a session was removed
   */
  delete(repoId) {
    return this.sessions.delete(repoId);
  }

  /** @returns {number} */
  get size() {
    return this.sessions.size;
  }
}

module.exports = { SessionStore };

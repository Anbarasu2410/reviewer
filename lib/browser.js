'use strict';

const childProcess = require('child_process');

/**
 * Opening a URL in the user's default browser.
 */

/**
 * The command that opens a URL on this platform.
 *
 * @param {string} platform a `process.platform` value
 * @param {string} url
 * @returns {{command: string, args: string[]}}
 */
function openCommand(platform, url) {
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: [url] };
    case 'win32':
      // `start` is a cmd builtin, not an executable. Its first quoted argument
      // is taken as the window title, so an empty one has to come first or the
      // URL itself would be swallowed as the title.
      return { command: 'cmd', args: ['/c', 'start', '', url] };
    default:
      return { command: 'xdg-open', args: [url] };
  }
}

/**
 * Open a URL in the default browser.
 *
 * Failure here is not worth interrupting anyone over — a headless machine has
 * no browser to open, and the caller has already printed the URL — so this
 * resolves either way and reports what happened.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.platform] defaults to the running platform
 * @param {typeof childProcess.spawn} [options.spawn] injectable for tests
 * @returns {Promise<boolean>} whether the opener was launched
 */
function openInBrowser(url, options = {}) {
  const { platform = process.platform, spawn = childProcess.spawn } = options;
  const { command, args } = openCommand(platform, url);

  return new Promise(resolve => {
    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true });

      // A missing opener fails asynchronously — spawn does not throw for it —
      // so success has to wait for the 'spawn' event rather than assume it.
      // Reporting success either way would make the caller's fallback message
      // unreachable on exactly the machines that need it.
      child.on('error', () => resolve(false));
      child.on('spawn', () => {
        // Let the opener outlive this process rather than hold the event loop.
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

module.exports = { openInBrowser, openCommand };

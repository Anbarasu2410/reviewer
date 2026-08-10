'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { openCommand, openInBrowser } = require('../lib/browser');

const URL_UNDER_TEST = 'http://127.0.0.1:4500/?repo=%2Fwork%2Fapi';

test('openCommand uses open on macOS', () => {
  assert.deepEqual(openCommand('darwin', URL_UNDER_TEST), {
    command: 'open',
    args: [URL_UNDER_TEST]
  });
});

test('openCommand uses xdg-open on Linux and anything unrecognised', () => {
  for (const platform of ['linux', 'freebsd', 'sunos']) {
    assert.deepEqual(openCommand(platform, URL_UNDER_TEST), {
      command: 'xdg-open',
      args: [URL_UNDER_TEST]
    });
  }
});

test('openCommand passes an empty window title before the URL on Windows', () => {
  // `start "http://..."` would treat the URL as the window title and open
  // nothing, so the empty title has to come first.
  const { command, args } = openCommand('win32', URL_UNDER_TEST);

  assert.equal(command, 'cmd');
  assert.deepEqual(args, ['/c', 'start', '', URL_UNDER_TEST]);
  assert.equal(args[args.length - 1], URL_UNDER_TEST);
});

/**
 * A stand-in for `spawn` that records the call. Never launches anything —
 * a test suite must not open a browser on the machine running it.
 *
 * @param {{fail?: 'throw'|'error'}} [behaviour]
 */
function fakeSpawn(behaviour = {}) {
  const calls = [];

  const spawn = (command, args, opts) => {
    calls.push({ command, args, opts });
    if (behaviour.fail === 'throw') throw new Error('spawn ENOENT');

    return {
      on(event, handler) {
        // Both events arrive asynchronously in the real thing.
        if (event === 'error' && behaviour.fail === 'error') queueMicrotask(handler);
        if (event === 'spawn' && !behaviour.fail) queueMicrotask(handler);
      },
      unref() {
        calls[calls.length - 1].unrefed = true;
      }
    };
  };

  return { spawn, calls };
}

test('openInBrowser launches the platform opener detached and silent', async () => {
  const { spawn, calls } = fakeSpawn();

  const launched = await openInBrowser(URL_UNDER_TEST, { platform: 'darwin', spawn });

  assert.equal(launched, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'open');
  assert.deepEqual(calls[0].args, [URL_UNDER_TEST]);
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].opts.stdio, 'ignore');
  assert.equal(calls[0].unrefed, true, 'the opener must not hold the event loop open');
});

test('openInBrowser reports failure when there is no opener installed', async () => {
  // A headless box has no browser; the caller has already printed the URL and
  // should carry on regardless.
  for (const fail of ['throw', 'error']) {
    const { spawn } = fakeSpawn({ fail });
    assert.equal(await openInBrowser(URL_UNDER_TEST, { platform: 'linux', spawn }), false, fail);
  }
});

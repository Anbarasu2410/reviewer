'use strict';

const express = require('express');
const cors = require('cors');
const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');

const { parseDiff } = require('./lib/diff');
const { resolveRepoFile, PathEscapeError } = require('./lib/paths');
const { collectWorkingChanges, collectCommitChanges } = require('./lib/changes');
const { SessionStore } = require('./lib/sessions');
const { normalizeComments } = require('./lib/comments');
const { formatReview, reviewFilename, commentsFilename } = require('./lib/review');

const DEFAULT_PORT = 4500;
const DEFAULT_HOST = '127.0.0.1';

/**
 * Build the review server.
 *
 * Everything the server keeps — open sessions, where reviews are written — is
 * passed in rather than reached for, so a test can point one instance at a
 * temporary directory without disturbing another.
 *
 * @param {object} [options]
 * @param {string} [options.reviewsDir] where comment and review files are written
 * @param {SessionStore} [options.sessions]
 * @param {(path: string) => import('simple-git').SimpleGit} [options.git] git factory, injectable for tests
 * @returns {import('express').Express}
 */
function createApp(options = {}) {
  const {
    reviewsDir = path.join(__dirname, 'reviews'),
    sessions = new SessionStore(),
    git: gitFactory = simpleGit
  } = options;

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.locals.sessions = sessions;
  app.locals.reviewsDir = reviewsDir;

  /**
   * Look up the session for a request, or answer 400.
   *
   * @param {import('express').Response} res
   * @param {string} repoId
   * @returns {{repoPath: string, mode: import('./lib/sessions').ReviewMode}|null}
   */
  function requireSession(res, repoId) {
    const session = sessions.get(repoId);
    if (!session) {
      res.status(400).json({ error: 'Invalid repository ID' });
      return null;
    }
    return session;
  }

  /**
   * Read one file as of the session's review mode.
   *
   * In `lastCommit` mode the committed text is authoritative; a file added by
   * that commit is not in its parent, so the working copy is the fallback.
   *
   * @param {{repoPath: string, mode: string}} session
   * @param {string} filePath repo-relative, already confined by the caller
   * @returns {Promise<string>}
   */
  async function readFileForMode(session, filePath) {
    const git = gitFactory(session.repoPath);
    const absolutePath = resolveRepoFile(session.repoPath, filePath);

    if (session.mode === 'lastCommit') {
      try {
        return await git.show([`HEAD:${filePath}`]);
      } catch {
        return await fs.readFile(absolutePath, 'utf-8').catch(() => '');
      }
    }

    return await fs.readFile(absolutePath, 'utf-8');
  }

  /**
   * Whether the repository has any commit yet.
   *
   * A freshly `git init`ed repository has an unborn HEAD, and every command
   * that names `HEAD` fails against it.
   *
   * @param {import('simple-git').SimpleGit} git
   * @returns {Promise<boolean>}
   */
  async function hasCommits(git) {
    try {
      await git.raw(['rev-parse', '--verify', 'HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Diff text for one file, as of the session's review mode.
   *
   * With no commit to compare against there is nothing to diff, and an empty
   * diff is what tells the parser to present the file as wholly new — which
   * is exactly what it is.
   *
   * @param {import('simple-git').SimpleGit} git
   * @param {{mode: string}} session
   * @param {string} filePath
   * @returns {Promise<string>}
   */
  async function diffForFile(git, session, filePath) {
    if (session.mode === 'lastCommit') {
      return git.diff(['HEAD~1', 'HEAD', '--', filePath]);
    }
    if (!(await hasCommits(git))) {
      return '';
    }
    return git.diff(['HEAD', '--', filePath]);
  }

  /** Liveness probe. The desktop shell polls this to know the server is up. */
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', sessions: sessions.size });
  });

  /** Open a repository and list what changed. */
  app.post('/api/load-repo', async (req, res) => {
    try {
      const { repoPath } = req.body ?? {};

      if (!repoPath) {
        return res.status(400).json({ error: 'Repository path is required' });
      }

      try {
        await fs.access(repoPath);
      } catch {
        return res.status(400).json({ error: 'Path does not exist' });
      }

      const git = gitFactory(repoPath);
      if (!(await git.checkIsRepo())) {
        return res.status(400).json({ error: 'Not a valid git repository' });
      }

      let files = collectWorkingChanges(await git.status());
      let mode = 'working';
      let message = `Found ${files.length} changed file(s)`;

      // A clean tree has nothing to review, so fall back to the last commit.
      if (files.length === 0) {
        try {
          const commitFiles = collectCommitChanges(await git.diffSummary(['HEAD~1', 'HEAD']));
          if (commitFiles.length > 0) {
            files = commitFiles;
            mode = 'lastCommit';
            message = `No working directory changes. Loaded last commit with ${files.length} changed file(s)`;
          }
        } catch (error) {
          // A repository with no commits, or only one, has no parent to diff
          // against. An empty file list is the correct answer there.
          console.error('Error loading last commit:', error.message);
        }
      }

      const repoId = sessions.create(repoPath, mode);
      console.log(`Loaded repository: ${repoPath} (mode: ${mode})`);

      res.json({ repoId, files, repoPath, mode, message });
    } catch (error) {
      console.error('Load repo error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /** Diff of one file, as structured lines. */
  app.get('/api/file/:repoId/:filePath(*)', async (req, res) => {
    try {
      const { repoId, filePath } = req.params;
      const session = requireSession(res, repoId);
      if (!session) return;

      const git = gitFactory(session.repoPath);
      const content = await readFileForMode(session, filePath);
      const diffText = await diffForFile(git, session, filePath);

      res.json({ filePath, diffLines: parseDiff(diffText, content) });
    } catch (error) {
      if (error instanceof PathEscapeError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('File read error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /** Whole file, for showing context around a comment. */
  app.get('/api/file-full/:repoId/:filePath(*)', async (req, res) => {
    try {
      const { repoId, filePath } = req.params;
      const session = requireSession(res, repoId);
      if (!session) return;

      const content = await readFileForMode(session, filePath);
      res.json({ filePath, lines: content.split('\n') });
    } catch (error) {
      if (error instanceof PathEscapeError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('File read error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /** Persist the current comments. Called on every edit. */
  app.post('/api/save-comments', async (req, res) => {
    try {
      const { repoId, comments } = req.body ?? {};
      const session = requireSession(res, repoId);
      if (!session) return;

      let normalized;
      try {
        normalized = normalizeComments(comments);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      await fs.mkdir(reviewsDir, { recursive: true });

      const data = {
        repoPath: session.repoPath,
        lastUpdated: new Date().toISOString(),
        comments: normalized
      };

      const target = path.join(reviewsDir, commentsFilename(session.repoPath));
      await fs.writeFile(target, `${JSON.stringify(data, null, 2)}\n`);

      res.json({ message: 'Comments saved successfully' });
    } catch (error) {
      console.error('Save comments error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /** Restore comments saved by an earlier session. */
  app.get('/api/load-comments/:repoId', async (req, res) => {
    try {
      const session = requireSession(res, req.params.repoId);
      if (!session) return;

      const source = path.join(reviewsDir, commentsFilename(session.repoPath));

      let raw;
      try {
        raw = await fs.readFile(source, 'utf-8');
      } catch {
        return res.json({ comments: [] });
      }

      res.json({ comments: JSON.parse(raw).comments ?? [] });
    } catch (error) {
      console.error('Load comments error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /** Render the saved comments into a timestamped review file. */
  app.post('/api/submit-review', async (req, res) => {
    try {
      const { repoId } = req.body ?? {};
      const session = requireSession(res, repoId);
      if (!session) return;

      // The JSON file is the source of truth, not whatever the client holds:
      // submitting renders exactly what was last saved.
      const source = path.join(reviewsDir, commentsFilename(session.repoPath));

      let comments = [];
      try {
        comments = JSON.parse(await fs.readFile(source, 'utf-8')).comments ?? [];
      } catch {
        return res.status(400).json({
          error: 'No comments found. Please add comments before submitting review.'
        });
      }

      if (comments.length === 0) {
        return res.status(400).json({
          error: 'No comments found. Please add comments before submitting review.'
        });
      }

      const generatedAt = new Date();
      const reviewContent = formatReview({ repoPath: session.repoPath, comments, generatedAt });
      const filename = reviewFilename(session.repoPath, generatedAt);

      await fs.mkdir(reviewsDir, { recursive: true });
      await fs.writeFile(path.join(reviewsDir, filename), reviewContent);

      console.log(`Review generated: ${filename} (${comments.length} comments)`);

      res.json({
        message: 'Review submitted successfully',
        reviewContent,
        filename,
        totalComments: comments.length
      });
    } catch (error) {
      console.error('Submit error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /** Drop a session. Saved comments on disk are left alone. */
  app.delete('/api/cleanup/:repoId', (req, res) => {
    sessions.delete(req.params.repoId);
    res.json({ message: 'Session cleaned up' });
  });

  return app;
}

/**
 * Start the server.
 *
 * Binds to loopback unless told otherwise. The server reads any file in the
 * repository under review, so reaching it should require being on the machine
 * running it; set `HOST=0.0.0.0` to opt out deliberately.
 *
 * @param {object} [options] forwarded to {@link createApp}, plus `port` and `host`
 * @returns {Promise<import('http').Server>} a listening server
 */
function startServer(options = {}) {
  const {
    port = process.env.PORT || DEFAULT_PORT,
    host = process.env.HOST || DEFAULT_HOST,
    ...appOptions
  } = options;
  const app = createApp(appOptions);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      console.log(`Code Reviewer server running on http://${host}:${server.address().port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

// Only listen when run directly; `require`ing this file just builds the app.
if (require.main === module) {
  startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

module.exports = { createApp, startServer, DEFAULT_PORT, DEFAULT_HOST };

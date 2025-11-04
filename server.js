const express = require('express');
const cors = require('cors');
const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 4500;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const REVIEWS_DIR = path.join(__dirname, 'reviews');

// Map to store repo paths (repoId -> actual path)
const repoPathMap = new Map();

// Load local repository and get changed files
app.post('/api/load-repo', async (req, res) => {
  try {
    const { repoPath } = req.body;

    if (!repoPath) {
      return res.status(400).json({ error: 'Repository path is required' });
    }

    // Verify path exists
    try {
      await fs.access(repoPath);
    } catch {
      return res.status(400).json({ error: 'Path does not exist' });
    }

    // Verify it's a git repository
    const git = simpleGit(repoPath);
    const isRepo = await git.checkIsRepo();

    if (!isRepo) {
      return res.status(400).json({ error: 'Not a valid git repository' });
    }

    // Get changed files (working directory vs last commit)
    const status = await git.status();

    // Get all modified, new, and deleted files
    const changedFiles = [
      ...status.modified,
      ...status.created,
      ...status.not_added
    ];

    // Generate unique ID for this session
    const repoId = crypto.randomBytes(8).toString('hex');
    repoPathMap.set(repoId, repoPath);

    console.log(`Loaded repository: ${repoPath}`);

    res.json({
      repoId,
      files: changedFiles,
      repoPath,
      message: `Found ${changedFiles.length} changed file(s)`
    });

  } catch (error) {
    console.error('Load repo error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Parse unified diff into structured format
function parseDiff(diffText, currentContent) {
  const lines = [];
  const diffLines = diffText.split('\n');
  const contentLines = currentContent.split('\n');

  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];

    // Parse hunk header @@ -old +new @@
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        oldLine = parseInt(match[1]);
        newLine = parseInt(match[2]);
        inHunk = true;
      }
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith('-')) {
      lines.push({
        oldLine: oldLine++,
        newLine: null,
        type: 'delete',
        content: line.substring(1)
      });
    } else if (line.startsWith('+')) {
      lines.push({
        oldLine: null,
        newLine: newLine++,
        type: 'add',
        content: line.substring(1)
      });
    } else if (line.startsWith(' ')) {
      lines.push({
        oldLine: oldLine++,
        newLine: newLine++,
        type: 'unchanged',
        content: line.substring(1)
      });
    }
  }

  // If no diff (new file), show all as added
  if (lines.length === 0) {
    contentLines.forEach((content, i) => {
      lines.push({
        oldLine: null,
        newLine: i + 1,
        type: 'add',
        content
      });
    });
  }

  return lines;
}

// Get file content and diff
app.get('/api/file/:repoId/:filePath(*)', async (req, res) => {
  try {
    const { repoId, filePath } = req.params;
    const repoPath = repoPathMap.get(repoId);

    if (!repoPath) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    const fullPath = path.join(repoPath, filePath);

    // Get current file content
    const content = await fs.readFile(fullPath, 'utf-8');

    // Get diff for this file
    const git = simpleGit(repoPath);
    const diffText = await git.diff(['HEAD', '--', filePath]);

    // Parse diff into structured format
    const diffLines = parseDiff(diffText, content);

    res.json({
      filePath,
      diffLines
    });

  } catch (error) {
    console.error('File read error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit review
app.post('/api/submit-review', async (req, res) => {
  try {
    const { repoId, comments } = req.body;

    if (!comments || comments.length === 0) {
      return res.status(400).json({ error: 'No comments provided' });
    }

    // Generate review content
    let reviewContent = '# Code Review\n\n';
    reviewContent += `Generated: ${new Date().toISOString()}\n\n`;

    // Group comments by file
    const fileGroups = {};
    comments.forEach(comment => {
      if (!fileGroups[comment.file]) {
        fileGroups[comment.file] = [];
      }
      fileGroups[comment.file].push(comment);
    });

    // Format review
    for (const [file, fileComments] of Object.entries(fileGroups)) {
      reviewContent += `## ${file}\n\n`;

      fileComments
        .sort((a, b) => a.line - b.line)
        .forEach(comment => {
          reviewContent += `**Line ${comment.line}:**\n`;
          reviewContent += `${comment.text}\n\n`;
        });
    }

    // Save review file
    const reviewPath = path.join(REVIEWS_DIR, 'review_this.txt');
    await fs.writeFile(reviewPath, reviewContent);

    res.json({
      message: 'Review submitted successfully',
      reviewPath,
      totalComments: comments.length
    });

  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cleanup endpoint - removes repo from session
app.delete('/api/cleanup/:repoId', async (req, res) => {
  try {
    const { repoId } = req.params;
    repoPathMap.delete(repoId);
    res.json({ message: 'Session cleaned up' });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Code Reviewer server running on http://localhost:${PORT}`);
});

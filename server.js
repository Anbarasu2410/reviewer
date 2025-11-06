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

    // Get all modified, new, and deleted files with their status
    const changedFiles = [
      ...status.modified.map(file => ({ path: file, status: 'M' })),
      ...status.created.map(file => ({ path: file, status: 'A' })),
      ...status.not_added.map(file => ({ path: file, status: 'A' }))
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

// Get full file content (all lines)
app.get('/api/file-full/:repoId/:filePath(*)', async (req, res) => {
  try {
    const { repoId, filePath } = req.params;
    const repoPath = repoPathMap.get(repoId);

    if (!repoPath) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    const fullPath = path.join(repoPath, filePath);

    // Get current file content
    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split('\n');

    res.json({
      filePath,
      lines
    });

  } catch (error) {
    console.error('File read error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save comments to file
app.post('/api/save-comments', async (req, res) => {
  try {
    const { repoId, comments } = req.body;

    const repoPath = repoPathMap.get(repoId);
    if (!repoPath) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    // Create unique filename from repo path
    const repoName = path.basename(repoPath);
    const filename = `.code-review-comments-${repoName}.json`;
    const commentsPath = path.join(REVIEWS_DIR, filename);

    // Ensure reviews directory exists
    try {
      await fs.mkdir(REVIEWS_DIR, { recursive: true });
    } catch (err) {
      // Directory might already exist
    }

    // Save comments with metadata
    const data = {
      repoPath,
      lastUpdated: new Date().toISOString(),
      comments: comments.map(c => {
        const comment = {
          file: c.file,
          line: c.line,
          lineContent: c.lineContent,
          text: c.text
        };

        // Only include selectedText if it's not null/undefined/empty
        if (c.selectedText) {
          comment.selectedText = c.selectedText;
        }

        return comment;
      })
    };

    await fs.writeFile(commentsPath, JSON.stringify(data, null, 2));

    res.json({ message: 'Comments saved successfully' });

  } catch (error) {
    console.error('Save comments error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Load comments from file
app.get('/api/load-comments/:repoId', async (req, res) => {
  try {
    const { repoId } = req.params;

    const repoPath = repoPathMap.get(repoId);
    if (!repoPath) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    // Create filename from repo path
    const repoName = path.basename(repoPath);
    const filename = `.code-review-comments-${repoName}.json`;
    const commentsPath = path.join(REVIEWS_DIR, filename);

    // Check if file exists
    try {
      await fs.access(commentsPath);
    } catch {
      return res.json({ comments: [] });
    }

    // Load comments
    const data = await fs.readFile(commentsPath, 'utf-8');
    const parsed = JSON.parse(data);

    res.json({ comments: parsed.comments || [] });

  } catch (error) {
    console.error('Load comments error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit review - read from JSON (source of truth) and generate txt
app.post('/api/submit-review', async (req, res) => {
  try {
    const { repoId } = req.body;

    const repoPath = repoPathMap.get(repoId);
    if (!repoPath) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    // Read from JSON file (single source of truth)
    const repoName = path.basename(repoPath);
    const jsonFilename = `.code-review-comments-${repoName}.json`;
    const jsonPath = path.join(REVIEWS_DIR, jsonFilename);

    let comments = [];
    try {
      const data = await fs.readFile(jsonPath, 'utf-8');
      const parsed = JSON.parse(data);
      comments = parsed.comments || [];
    } catch (error) {
      // No saved comments found
      return res.status(400).json({ error: 'No comments found. Please add comments before submitting review.' });
    }

    if (comments.length === 0) {
      return res.status(400).json({ error: 'No comments found. Please add comments before submitting review.' });
    }

    // Generate review content from JSON
    let reviewContent = '# Code Review\n\n';
    reviewContent += `Repository: ${repoPath}\n`;
    reviewContent += `Generated: ${new Date().toISOString()}\n`;
    reviewContent += `Total Comments: ${comments.length}\n\n`;

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
          if (comment.lineContent) {
            reviewContent += `\`\`\`\n${comment.lineContent}\n\`\`\`\n`;
          }
          if (comment.selectedText) {
            reviewContent += `**Selected code:**\n\`\`\`\n${comment.selectedText}\n\`\`\`\n`;
          }
          reviewContent += `${comment.text}\n\n`;
        });
    }

    // Create unique filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T').join('_');
    const filename = `review_${repoName}_${timestamp}.txt`;
    const reviewPath = path.join(REVIEWS_DIR, filename);

    // Save review file
    await fs.writeFile(reviewPath, reviewContent);

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

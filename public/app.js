const API_BASE = 'http://localhost:4500/api';

let currentRepoId = null;
let currentFiles = [];
let currentFile = null;
let comments = [];

// Load local repository
async function loadRepo() {
  const repoPath = document.getElementById('repoPath').value.trim();

  if (!repoPath) {
    showStatus('Please enter a repository path', 'error');
    return;
  }

  showStatus('Loading repository...', 'loading');
  document.getElementById('loadBtn').disabled = true;

  try {
    const response = await fetch(`${API_BASE}/load-repo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to load repository');
    }

    currentRepoId = data.repoId;
    currentFiles = data.files;

    if (data.files.length === 0) {
      showStatus('No uncommitted changes found in the repository', 'error');
      document.getElementById('loadBtn').disabled = false;
      return;
    }

    showStatus(data.message, 'success');
    displayFiles(data.files);

  } catch (error) {
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    document.getElementById('loadBtn').disabled = false;
  }
}

// Display list of changed files
function displayFiles(files) {
  const sidebar = document.getElementById('sidebar');
  const filesList = document.getElementById('filesList');
  const fileCount = document.getElementById('fileCount');
  const submitBtn = document.getElementById('submitReviewBtn');

  filesList.innerHTML = files.map((file, index) =>
    `<div class="file-item" onclick="loadFile('${file}', ${index})">${file}</div>`
  ).join('');

  fileCount.textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
  sidebar.classList.remove('hidden');
  submitBtn.classList.remove('hidden');
}

// Load file content
async function loadFile(filePath, index) {
  if (!currentRepoId) return;

  currentFile = filePath;

  // Update active file highlight
  document.querySelectorAll('.file-item').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });

  try {
    const response = await fetch(`${API_BASE}/file/${currentRepoId}/${filePath}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to load file');
    }

    displayCode(data.filePath, data.content);

  } catch (error) {
    showStatus(`Error loading file: ${error.message}`, 'error');
  }
}

// Display code with line numbers
function displayCode(filePath, content) {
  const codeSection = document.getElementById('codeSection');
  const currentFileEl = document.getElementById('currentFile');
  const codeViewer = document.getElementById('codeViewer');

  currentFileEl.textContent = filePath;

  const lines = content.split('\n');
  const fileComments = comments.filter(c => c.file === filePath);

  let html = '';
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const hasComment = fileComments.find(c => c.line === lineNum);

    html += `
      <div class="line ${hasComment ? 'commented' : ''}" data-line="${lineNum}">
        ${hasComment ? '<span class="comment-indicator"></span>' : ''}
        <div class="line-number" onclick="toggleCommentInput(${lineNum})">${lineNum}</div>
        <div class="line-content">${escapeHtml(line) || ' '}</div>
      </div>
    `;

    if (hasComment) {
      html += `
        <div class="comment-box">
          <span class="comment-text">${escapeHtml(hasComment.text)}</span>
          <button class="comment-delete" onclick="deleteComment(${lineNum})">Delete</button>
        </div>
      `;
    }
  });

  codeViewer.innerHTML = html;
  codeSection.classList.remove('hidden');
}

// Toggle comment input
function toggleCommentInput(lineNum) {
  const existing = document.querySelector('.comment-input-box');
  if (existing) {
    existing.remove();
  }

  // Check if comment already exists
  if (comments.find(c => c.file === currentFile && c.line === lineNum)) {
    return;
  }

  const lineEl = document.querySelector(`.line[data-line="${lineNum}"]`);
  const inputBox = document.createElement('div');
  inputBox.className = 'comment-input-box';
  inputBox.innerHTML = `
    <textarea placeholder="Enter your comment..." id="commentInput"></textarea>
    <div class="actions">
      <button onclick="saveComment(${lineNum})">Save Comment</button>
      <button class="cancel-btn" onclick="this.closest('.comment-input-box').remove()">Cancel</button>
    </div>
  `;

  lineEl.after(inputBox);
  document.getElementById('commentInput').focus();
}

// Save comment
function saveComment(lineNum) {
  const input = document.getElementById('commentInput');
  const text = input.value.trim();

  if (!text) {
    alert('Please enter a comment');
    return;
  }

  comments.push({
    file: currentFile,
    line: lineNum,
    text: text
  });

  // Reload the current file to show the new comment
  const fileIndex = currentFiles.indexOf(currentFile);
  loadFile(currentFile, fileIndex);
}

// Delete comment
function deleteComment(lineNum) {
  comments = comments.filter(c => !(c.file === currentFile && c.line === lineNum));

  // Reload the current file to remove the comment
  const fileIndex = currentFiles.indexOf(currentFile);
  loadFile(currentFile, fileIndex);
}

// Submit review
async function submitReview() {
  if (comments.length === 0) {
    showStatus('Please add at least one comment before submitting', 'error');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/submit-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoId: currentRepoId,
        comments: comments
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to submit review');
    }

    showStatus(`Review submitted successfully! ${data.totalComments} comments saved to review_this.txt`, 'success');

  } catch (error) {
    showStatus(`Error: ${error.message}`, 'error');
  }
}

// Cleanup session
async function cleanupRepo() {
  if (!currentRepoId) return;

  try {
    await fetch(`${API_BASE}/cleanup/${currentRepoId}`, {
      method: 'DELETE'
    });

    showStatus('Session cleared', 'success');
    resetApp();

  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Reset application
function resetApp() {
  currentRepoId = null;
  currentFiles = [];
  currentFile = null;
  comments = [];

  document.getElementById('repoPath').value = '';
  document.getElementById('sidebar').classList.add('hidden');
  document.getElementById('codeSection').classList.add('hidden');
  document.getElementById('submitReviewBtn').classList.add('hidden');
  document.getElementById('status').textContent = '';
  document.getElementById('status').className = 'status';
}

// Show status message
function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Allow Enter key to load repo
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('repoPath').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      loadRepo();
    }
  });
});

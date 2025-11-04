const API_BASE = 'http://localhost:4500/api';

let currentRepoId = null;
let currentFiles = [];
let currentFile = null;
let currentDiffLines = [];
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
  const resizeHandle = document.getElementById('resizeHandle');

  filesList.innerHTML = files.map((fileObj, index) => {
    const file = fileObj.path;
    const status = fileObj.status;
    const parts = file.split('/');
    const filename = parts[parts.length - 1];
    const path = parts.slice(0, -1).join('/');

    // Because of RTL, we need to reverse the order in HTML
    const displayText = path ? `${path}/<span class="filename">${filename}</span>` : `<span class="filename">${filename}</span>`;
    const statusClass = status === 'A' ? 'file-status-added' : 'file-status-modified';
    const statusBadge = `<span class="file-status ${statusClass}">${status}</span>`;

    return `<div class="file-item" onclick="loadFile('${file}', ${index})" title="${escapeHtml(file)}">
      ${statusBadge}<span class="file-path-text">${displayText}</span>
    </div>`;
  }).join('');

  fileCount.textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
  sidebar.classList.remove('hidden');
  resizeHandle.classList.remove('hidden');
  submitBtn.classList.remove('hidden');
}

// Load file content
async function loadFile(filePath, index) {
  if (!currentRepoId) return Promise.resolve();

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

    displayCode(data.filePath, data.diffLines);
    return Promise.resolve();

  } catch (error) {
    showStatus(`Error loading file: ${error.message}`, 'error');
    return Promise.reject(error);
  }
}

// Display code with diff highlighting
function displayCode(filePath, diffLines) {
  const codeSection = document.getElementById('codeSection');
  const currentFileEl = document.getElementById('currentFile');
  const codeViewer = document.getElementById('codeViewer');

  currentFileEl.textContent = filePath;
  currentDiffLines = diffLines; // Store for reference when adding comments

  const fileComments = comments.filter(c => c.file === filePath);

  let html = '';
  diffLines.forEach((diffLine, index) => {
    // Use diffLineIndex to uniquely identify each line in the diff
    const diffLineIndex = index;
    const hasComment = fileComments.find(c => c.diffLineIndex === diffLineIndex);

    const lineClass = `line diff-${diffLine.type} ${hasComment ? 'commented' : ''}`;

    // Use the appropriate line number for clicking (newLine for add/unchanged, oldLine for delete)
    const clickableLineNum = diffLine.newLine || diffLine.oldLine;

    // Make both old and new line numbers clickable
    const oldLineClick = diffLine.type === 'delete' ? `onclick="toggleCommentInput(${diffLineIndex})"` : '';
    const newLineClick = diffLine.type !== 'delete' ? `onclick="toggleCommentInput(${diffLineIndex})"` : '';

    html += `
      <div class="${lineClass}" data-diff-index="${diffLineIndex}">
        ${hasComment ? '<span class="comment-indicator"></span>' : ''}
        <div class="line-numbers">
          <span class="old-line-number" ${oldLineClick}>${diffLine.oldLine || ''}</span>
          <span class="new-line-number" ${newLineClick}>${diffLine.newLine || ''}</span>
        </div>
        <div class="line-content">${escapeHtml(diffLine.content) || ' '}</div>
      </div>
    `;

    if (hasComment) {
      const selectedTextAttr = hasComment.selectedText ? `'${escapeHtml(hasComment.selectedText).replace(/'/g, "\\'")}'` : 'null';
      html += `
        <div class="comment-box">
          <span class="comment-text">${escapeHtml(hasComment.text)}</span>
          <div class="comment-actions">
            <button class="comment-edit" onclick="editComment(${diffLineIndex}, ${selectedTextAttr})">Edit</button>
            <button class="comment-delete" onclick="deleteComment(${diffLineIndex})">Delete</button>
          </div>
        </div>
      `;
    }
  });

  codeViewer.innerHTML = html;
  codeSection.classList.remove('hidden');

  // Add text selection handler
  codeViewer.removeEventListener('mousedown', trackShiftKeyDown);
  codeViewer.removeEventListener('mouseup', handleTextSelection);
  codeViewer.addEventListener('mousedown', trackShiftKeyDown);
  codeViewer.addEventListener('mouseup', handleTextSelection);
}

// Track command key state during selection
let commandKeyPressed = false;

// Track command key on mousedown
function trackShiftKeyDown(e) {
  commandKeyPressed = e.metaKey;
}

// Handle text selection in code viewer
function handleTextSelection(e) {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  if (!selectedText) {
    commandKeyPressed = false;
    return;
  }

  // Only trigger comment input if Command key was held during selection
  if (!commandKeyPressed) {
    commandKeyPressed = false;
    return;
  }

  // Reset command key tracking
  commandKeyPressed = false;

  // Find the line element where selection ends
  let targetElement = selection.focusNode;

  // Traverse up to find the line element
  while (targetElement && !targetElement.classList?.contains('line')) {
    targetElement = targetElement.parentElement;
  }

  if (!targetElement) {
    return;
  }

  const diffLineIndex = parseInt(targetElement.dataset.diffIndex);
  if (diffLineIndex === undefined || isNaN(diffLineIndex)) {
    return;
  }

  // Clear selection
  selection.removeAllRanges();

  // Show comment input with selected text
  toggleCommentInputWithSelection(diffLineIndex, selectedText);
}

// Toggle comment input
function toggleCommentInput(diffLineIndex) {
  toggleCommentInputWithSelection(diffLineIndex, null);
}

// Toggle comment input with optional selected text
function toggleCommentInputWithSelection(diffLineIndex, selectedText = null) {
  const existing = document.querySelector('.comment-input-box');
  if (existing) {
    existing.remove();
  }

  // Check if comment already exists
  if (comments.find(c => c.file === currentFile && c.diffLineIndex === diffLineIndex)) {
    return;
  }

  const lineEl = document.querySelector(`.line[data-diff-index="${diffLineIndex}"]`);
  const inputBox = document.createElement('div');
  inputBox.className = 'comment-input-box';

  // Show selected text if available
  const selectedTextHtml = selectedText
    ? `<div class="selected-text-preview">
         <strong>Selected code:</strong>
         <pre>${escapeHtml(selectedText)}</pre>
       </div>`
    : '';

  inputBox.innerHTML = `
    ${selectedTextHtml}
    <textarea placeholder="Enter your comment (Cmd/Ctrl+Enter to save)..." id="commentInput"></textarea>
    <div class="actions">
      <button onclick="saveComment(${diffLineIndex}, ${selectedText ? `\`${escapeHtml(selectedText).replace(/`/g, '\\`')}\`` : 'null'})">Save Comment</button>
      <button class="cancel-btn" onclick="this.closest('.comment-input-box').remove()">Cancel</button>
    </div>
  `;

  lineEl.after(inputBox);
  const textarea = document.getElementById('commentInput');
  textarea.focus();

  // Auto-resize textarea
  const autoResize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  };

  textarea.addEventListener('input', autoResize);
  autoResize(); // Initial resize

  // Add keyboard shortcuts
  textarea.addEventListener('keydown', (e) => {
    // Cmd/Ctrl+Enter to save
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      saveComment(diffLineIndex, selectedText);
    }
    // Escape to close
    if (e.key === 'Escape') {
      e.preventDefault();
      inputBox.remove();
    }
  });
}

// Save comment
function saveComment(diffLineIndex, selectedText = null) {
  const input = document.getElementById('commentInput');
  const text = input.value.trim();

  if (!text) {
    showStatus('Please enter a comment', 'error');
    return;
  }

  // Find the diff line
  const diffLine = currentDiffLines[diffLineIndex];
  if (!diffLine) return;

  const lineContent = diffLine.content || '';
  const lineNum = diffLine.newLine || diffLine.oldLine;

  comments.push({
    file: currentFile,
    diffLineIndex: diffLineIndex,
    line: lineNum,
    lineContent: lineContent,
    selectedText: selectedText,
    text: text
  });

  // Reload the current file to show the new comment
  const fileIndex = currentFiles.findIndex(f => f.path === currentFile);
  loadFile(currentFile, fileIndex);
}

// Edit comment
function editComment(diffLineIndex, selectedText = null) {
  const comment = comments.find(c => c.file === currentFile && c.diffLineIndex === diffLineIndex);
  if (!comment) return;

  // Remove the comment from the list temporarily
  comments = comments.filter(c => !(c.file === currentFile && c.diffLineIndex === diffLineIndex));

  // Reload file and show edit input
  const fileIndex = currentFiles.findIndex(f => f.path === currentFile);
  loadFile(currentFile, fileIndex).then(() => {
    // Show comment input with existing text
    const lineEl = document.querySelector(`.line[data-diff-index="${diffLineIndex}"]`);
    if (!lineEl) return;

    const inputBox = document.createElement('div');
    inputBox.className = 'comment-input-box';

    const selectedTextHtml = selectedText
      ? `<div class="selected-text-preview">
           <strong>Selected code:</strong>
           <pre>${escapeHtml(selectedText)}</pre>
         </div>`
      : '';

    inputBox.innerHTML = `
      ${selectedTextHtml}
      <textarea placeholder="Enter your comment (Cmd/Ctrl+Enter to save)..." id="commentInput">${escapeHtml(comment.text)}</textarea>
      <div class="actions">
        <button onclick="saveComment(${diffLineIndex}, ${selectedText ? `\`${escapeHtml(selectedText).replace(/`/g, '\\`')}\`` : 'null'})">Save Comment</button>
        <button class="cancel-btn" onclick="this.closest('.comment-input-box').remove()">Cancel</button>
      </div>
    `;

    lineEl.after(inputBox);
    const textarea = document.getElementById('commentInput');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    // Auto-resize textarea
    const autoResize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    };

    textarea.addEventListener('input', autoResize);
    autoResize(); // Initial resize

    // Add keyboard shortcuts
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        saveComment(diffLineIndex, selectedText);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        inputBox.remove();
        // Restore the comment if canceled
        comments.push(comment);
        const fileIndex = currentFiles.findIndex(f => f.path === currentFile);
        loadFile(currentFile, fileIndex);
      }
    });
  });
}

// Delete comment
function deleteComment(diffLineIndex) {
  comments = comments.filter(c => !(c.file === currentFile && c.diffLineIndex === diffLineIndex));

  // Reload the current file to remove the comment
  const fileIndex = currentFiles.findIndex(f => f.path === currentFile);
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

    showReviewModal(data.reviewContent, data.filename);
    showStatus(`Review submitted successfully! ${data.totalComments} comments`, 'success');

  } catch (error) {
    showStatus(`Error: ${error.message}`, 'error');
  }
}

// Show review modal with download and copy options
function showReviewModal(reviewContent, filename) {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.className = 'review-modal';
  modal.innerHTML = `
    <div class="review-modal-content">
      <div class="review-modal-header">
        <h2>Review Submitted</h2>
        <button class="close-modal" onclick="this.closest('.review-modal').remove()">×</button>
      </div>
      <div class="review-modal-body">
        <pre class="review-text">${escapeHtml(reviewContent)}</pre>
      </div>
      <div class="review-modal-footer">
        <button onclick="downloadReview('${filename}', this.closest('.review-modal').querySelector('.review-text').textContent)">
          Download ${filename}
        </button>
        <button onclick="copyReviewToClipboard(this.closest('.review-modal').querySelector('.review-text').textContent)">
          Copy to Clipboard
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

// Download review as file
function downloadReview(filename, content) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showStatus('Review downloaded successfully', 'success');
}

// Copy review to clipboard
async function copyReviewToClipboard(content) {
  try {
    await navigator.clipboard.writeText(content);
    showStatus('Review copied to clipboard!', 'success');
  } catch (error) {
    showStatus('Failed to copy to clipboard', 'error');
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
  document.getElementById('resizeHandle').classList.add('hidden');
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

// Show full file context (all lines, not just diff)
async function showFullContext() {
  if (!currentRepoId || !currentFile) return;

  try {
    const response = await fetch(`${API_BASE}/file-full/${currentRepoId}/${currentFile}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to load full file content');
    }

    displayFullContext(data.filePath, data.lines);

  } catch (error) {
    showStatus(`Error loading full context: ${error.message}`, 'error');
  }
}

// Display full file content with deleted lines
function displayFullContext(filePath, lines) {
  const codeViewer = document.getElementById('codeViewer');
  const fileComments = comments.filter(c => c.file === filePath);

  // Create a merged view: currentDiffLines + missing lines from full content
  const mergedLines = [];
  const coveredNewLines = new Set();

  // First, add all diff lines (includes deleted, added, and changed lines)
  let lastNewLine = 0;
  currentDiffLines.forEach(diffLine => {
    // Check if we need to fill in any missing lines before this diffLine
    if (diffLine.newLine && diffLine.newLine > lastNewLine + 1) {
      // Fill in the gap with unchanged lines
      for (let i = lastNewLine + 1; i < diffLine.newLine; i++) {
        if (lines[i - 1] !== undefined) {
          mergedLines.push({
            oldLine: i,
            newLine: i,
            type: 'unchanged',
            content: lines[i - 1]
          });
          coveredNewLines.add(i);
        }
      }
    }

    mergedLines.push(diffLine);
    if (diffLine.newLine) {
      coveredNewLines.add(diffLine.newLine);
      lastNewLine = diffLine.newLine;
    }
  });

  // Add any remaining lines after the last diff
  for (let i = lastNewLine + 1; i <= lines.length; i++) {
    if (!coveredNewLines.has(i) && lines[i - 1] !== undefined) {
      mergedLines.push({
        oldLine: i,
        newLine: i,
        type: 'unchanged',
        content: lines[i - 1]
      });
    }
  }

  // Find matching diffLineIndex for comments in full context
  // Need to map mergedLines back to original diffLines indices
  const mergedToDiffIndexMap = new Map();
  mergedLines.forEach((mergedLine, mergedIndex) => {
    // Find this line in original diffLines
    const diffIndex = currentDiffLines.findIndex(dl =>
      (dl.newLine === mergedLine.newLine && dl.oldLine === mergedLine.oldLine && dl.content === mergedLine.content)
    );
    if (diffIndex !== -1) {
      mergedToDiffIndexMap.set(mergedIndex, diffIndex);
    }
  });

  // Now render the merged lines
  let html = '';
  mergedLines.forEach((diffLine, mergedIndex) => {
    const diffLineIndex = mergedToDiffIndexMap.get(mergedIndex);
    const hasComment = diffLineIndex !== undefined ? fileComments.find(c => c.diffLineIndex === diffLineIndex) : null;

    const lineClass = `line diff-${diffLine.type} ${hasComment ? 'commented' : ''}`;
    const dataDiffIndexAttr = diffLineIndex !== undefined ? `data-diff-index="${diffLineIndex}"` : '';

    html += `
      <div class="${lineClass}" ${dataDiffIndexAttr}>
        ${hasComment ? '<span class="comment-indicator"></span>' : ''}
        <div class="line-numbers">
          <span class="old-line-number">${diffLine.oldLine || ''}</span>
          <span class="new-line-number" ${diffLineIndex !== undefined ? `onclick="toggleCommentInput(${diffLineIndex})"` : ''}>${diffLine.newLine || ''}</span>
        </div>
        <div class="line-content">${escapeHtml(diffLine.content) || ' '}</div>
      </div>
    `;

    if (hasComment) {
      const selectedTextAttr = hasComment.selectedText ? `'${escapeHtml(hasComment.selectedText).replace(/'/g, "\\'")}'` : 'null';
      html += `
        <div class="comment-box">
          <span class="comment-text">${escapeHtml(hasComment.text)}</span>
          <div class="comment-actions">
            <button class="comment-edit" onclick="editComment(${diffLineIndex}, ${selectedTextAttr})">Edit</button>
            <button class="comment-delete" onclick="deleteComment(${diffLineIndex})">Delete</button>
          </div>
        </div>
      `;
    }
  });

  codeViewer.innerHTML = html;

  // Add text selection handler for full context too
  codeViewer.removeEventListener('mousedown', trackShiftKeyDown);
  codeViewer.removeEventListener('mouseup', handleTextSelection);
  codeViewer.addEventListener('mousedown', trackShiftKeyDown);
  codeViewer.addEventListener('mouseup', handleTextSelection);

  showStatus('Showing full file context', 'success');
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Sidebar resize functionality
function initResizeHandle() {
  const resizeHandle = document.getElementById('resizeHandle');
  const sidebar = document.getElementById('sidebar');
  let isResizing = false;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeHandle.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const newWidth = e.clientX;
    const minWidth = 200;
    const maxWidth = 600;

    if (newWidth >= minWidth && newWidth <= maxWidth) {
      sidebar.style.width = `${newWidth}px`;
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizeHandle.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// Allow Enter key to load repo
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('repoPath').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      loadRepo();
    }
  });

  // Initialize resize handle
  initResizeHandle();
});

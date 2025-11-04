# Code Reviewer

A web-based code review tool for reviewing uncommitted changes in Git repositories.

## Features

- Load any local Git repository
- Automatically detect uncommitted changes (working directory vs last commit)
- View changed files with syntax highlighting
- Add inline comments on any line
- Submit review to generate `review_this.txt` file

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open your browser:
   ```
   http://localhost:4500
   ```

## Usage

1. Enter a local Git repository path (e.g., `/Users/name/projects/myrepo`)
2. Click "Load Repository"
3. Select a changed file from the list
4. Click on any line number to add a comment
5. Click "Submit Review" when done
6. Find your review in `reviews/review_this.txt`

## Tech Stack

- **Backend**: Node.js + Express
- **Git Operations**: simple-git
- **Frontend**: Vanilla JavaScript
- **Syntax Highlighting**: Prism.js

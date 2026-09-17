# Maintaining `reviewer`

Notes for whoever maintains this next. The architecture is readable from the
code, so this file is deliberately not about architecture — it is about the
things that cost someone a day to learn and are invisible in a diff.

Accurate as of 2.6.0 (2026-09-17).

## 1. What it is, in one sentence

`reviewer` gives you the pull-request review view of your own working
directory — inline comments anchored to exact lines, with no branch, no remote,
no push and no account — and then hands the marked-up review to a coding agent
to apply.

The last clause is the product. Everything else is a means to it:

```bash
reviewer | claude -p "Apply this review to the repo."
```

`reviewer` opens the browser, you comment, you press submit, and the review
leaves on stdout as an agent-ready prompt. What the agent receives is
`code-review/v1`:

```json
{
  "schema": "code-review/v1",
  "repository": { "name": "api-service", "head": "abe3b37", "branch": "main" },
  "mode": "working",
  "summary": { "comments": 2, "files": 1 },
  "comments": [
    { "id": "src/auth.js:10", "file": "src/auth.js", "anchor": "const token = req.headers.authorization" }
  ]
}
```

`anchor` is the load-bearing field. Line numbers go stale the moment the agent
makes its first edit; the anchor text survives. Anything you add to the export
should assume line numbers are already wrong.

## 2. Running it

```bash
npm ci
node --test          # 273 tests, ~5s, all green
npm start            # serves the UI for the current directory
```

Green looks like `pass 273 / fail 0`. There is no linter and no build step;
three runtime dependencies, and the project would like to keep it that way.
CI is `ci.yml` on Linux and macOS across Node 18/20/22. Windows is absent on
purpose — its runners never picked up a job — and that is documented in the
workflow rather than left to be rediscovered.

## 3. Traps

These are the expensive ones. Each was a real defect, not a hypothetical.

**stdout is the product.** When stdout is not a TTY, the review is the only
thing allowed on it. A stray `console.log` anywhere in the server or libraries
corrupts the payload the agent parses. This is why there are no `console.log`
calls in `server.js`; diagnostics go to stderr via `note()`. If you add
logging, send it to stderr.

**The single newline in `bin/reviewer.js` is not decorative.** `claude -p`
waits three seconds for the *first byte* on piped stdin and then proceeds
without stdin at all — printing a warning and exiting **0**. Reviewing takes
minutes. So the handoff path writes one `\n` at startup to hold the stream
open, long before there is a review to send. Delete that line and
`reviewer | claude -p` silently does nothing useful while still exiting
successfully, so no test and no CI leg catches it. **This shipped broken in
2.4.0** — both halves were tested separately and never composed. The test that
guards it asserts the first byte is out *by the time the banner appears*; it is
a composition test and must stay one.

**`git diff -- <path>` from a subdirectory returns an empty string, not an
error.** `git status --porcelain` reports paths relative to the worktree root,
but a pathspec resolves relative to the process's directory. Run the two
together from a subdirectory and you get a clean, confident, wrong answer. Every
git call therefore resolves the worktree root first — `lib/repo.js`, via
`rev-parse --show-toplevel`. Do not reintroduce a raw `cwd` path into a
pathspec.

**`simpleGit()` throws synchronously at construction** when handed a path that
does not exist. The constructor has to be *inside* the `try`, not above it. The
usual shape (`const git = simpleGit(dir); try { ... }`) throws past your handler.

**`escapeHtml` cannot secure a JavaScript string context.** HTML entities are
decoded *before* the attribute is parsed as JavaScript, so an escaped quote
inside `onclick="..."` is still a quote by the time the JS parser sees it — a
crafted *filename* was enough to execute script. The fix is structural: every
interpolation into an inline handler is wrapped in `Number(...)`, and strings
travel in `data-` attributes instead. `test/page.test.js` scans for both rules.
If that test fails, do not relax it — it is the control, not a style
preference.

**Do not merge on a green-looking check list before the checks have
registered.** `gh pr checks` reports success against an empty set. I merged
two PRs this way (#39, #61) before the runs existed. Gate on a non-empty pass
list, not on the absence of failures. The Node 18 legs take 3–5 minutes.

## 4. Releasing

Standing instruction from the owner: **if `main` is ahead of the published
version, cut the release.** A merge that never ships is an unfinished merge.

```bash
git log v$(npm view git-reviewer version)..main --oneline    # anything here?
```

Publishing is OIDC trusted publishing on a `v*` tag. **There is no npm token in
this repository and there must not be one** — the existing tokens are revoked
and will 401 if you try. The whole release is: changelog, version bump, PR,
merge, tag, push tag.

Three things must keep matching npm's trust record or the publish is rejected:
the repository, the *filename* `release.yml`, and the absence of an
environment. Renaming that workflow file is a breaking change.

Verify by installing the published artifact fresh. Not by reading the green
tick.

Docs-only and test-only commits do not need a release of their own. Behaviour
changes do.

**README images are a free channel.** npm rewrites relative image paths to
`https://raw.githubusercontent.com/<repo>/HEAD/<path>`, so replacing
`docs/demo.gif` on `main` updates the npm listing without a release. Verified
live, not assumed.

## 5. The demo

The README leads with `docs/demo.gif` / `docs/demo.mp4`. The harness that
produces them is **not in this repository** — it needs playwright and ffmpeg,
and this package ships three dependencies. It lives on the owner's machine at
`~/.oss-sweep/demo-harness/` with its own README.

Re-record when the UI changes; a demo of a version that no longer exists is
worse than no demo. Two traps are written up there: the three segments share
one repository and one review, so the comments the closing segment exports must
be the ones the middle segment was filmed writing; and the folder picker lists
the real home directory, which is why the demo loads its repository directly
instead of going through the picker.

`docs/demo.*` currently predates the 2.6.0 "say which files you have commented
on" change. Not misleading, but not current either.

## 6. What not to do

- **Do not open the CORS hole.** The owner assessed it and declined the fix.
  It is a settled decision, not an oversight; do not re-file it.
- **Do not create an npm token.** See §4. The tag is the mechanism.
- **Do not post to the owner's community accounts** (Reddit, HN, X) without his
  explicit go-ahead on the specific text. Those posts go out in his voice, from
  his account. There is a drafted and *unsent* r/ClaudeAI post; it stays unsent
  until he says otherwise in his own words.
- **Do not weaken `test/page.test.js`.** See §3.
- **Do not add dependencies casually.** The count is a documented feature.

## 7. Open work, in priority order

1. **#20 and #25** — both `good first issue`, both real, and they are *one*
   bug: `lib/changes.js` mangles paths in `lastCommit` mode, octal-escaping
   non-ASCII names (line 41) and leaving renames as `old => new` (line 81).
   Either fix alone passes its own test and leaves the other symptom. They must
   be fixed together. Diagnosis re-verified against today's `main`.
2. **#32** — `repository.head` is read live at export time, so the documented
   staleness check cannot work. The docs describe a guarantee the code does not
   provide.
3. **#28** — a comment body can forge a file heading in the prompt export,
   inventing a section for a file nobody reviewed.
4. **#3 / #2 / #4** — the agent-integration arc, and they are ordered: `#3`
   (report whether each anchor still matches) is the prerequisite for `#2`
   (comment state / `resolve`), which is the prerequisite for `#4` (MCP).
   Doing #4 first produces an MCP surface over an unstable identity.
5. **#15** — Express 5 removes the `:filePath(*)` route syntax. Not urgent,
   but it is a dependency cliff rather than a feature.

**Known unresolved design question, now public as [Discussion #63]:** whether a
review should live outside the repo (where moving the checkout orphans it, per
#17) or inside it (where it shows up in `git status`). Do not unilaterally pick
one — it is open for community input on purpose.

**Waiting on a human:** @GoodJobwilliam's schema questions on #4 were answered
on 2026-09-17; the `id`-stability gap that answer exposed is real and should be
settled before any MCP work begins.

## 8. Honest state

1 star. 2 forks. Effectively zero npm downloads. The tool works and is
released; almost nobody has been told it exists. That, not the code, is the
binding constraint — and it is not one more bug fix away.

[Discussion #63]: https://github.com/dheerajjha/reviewer/discussions/63

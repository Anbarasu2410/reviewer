<!-- Thanks for contributing. Keep this short; the diff says most of it. -->

## What this changes

<!-- The symptom, not just the fix. "Deleted files never appeared in the
     sidebar" tells the next reader more than "update collectWorkingChanges". -->

## Why

<!-- What made this worth doing. Link an issue if there is one. -->

## How it was verified

<!-- Which test fails without this change? If the change is not testable,
     say what you did by hand and in which repository state. -->

## Checklist

- [ ] `npm test` passes
- [ ] A test covers the change, and fails without it
- [ ] `CHANGELOG.md` has an entry under `## [Unreleased]` if a user would notice
- [ ] Any new filesystem path goes through `resolveRepoFile()`

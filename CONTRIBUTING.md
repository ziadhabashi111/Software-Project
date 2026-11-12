# Contributing Guide

Follow this for every change. The team leader reviews all PRs.

## Branches

- `develop`: the integration branch. Everyone's work is pushed here first to make sure everything works together.
- `main`: only verified, working code. It receives `develop` once `develop` is confirmed working.
- **Always make a branch when making changes. Never commit or push straight to `develop` or `main`**; everything merges via a reviewed pull request (branch protection enforces this).
- **Pull the latest `develop` before pushing your changes** (see Daily Flow).
- **Never merge with conflicts.** Resolve them on your own branch first, re-test, then merge.
- Short-lived branches from the latest `develop`:
  - `feature/<REQ-ID>-<description>`, e.g. `feature/FLT-11-flight-search`
  - `fix/<REQ-ID>-<description>`, e.g. `fix/FLT-22-seat-hold-race-condition`
  - `refactor/<description>`
  - `docs/<description>`

## Daily Flow

```bash
git checkout develop
git pull origin develop
git checkout -b feature/FLT-11-flight-search

# work, then commit small and often
git add <files>
git commit -m "feat(flights): implement search"

# before pushing: bring in the latest develop, fix any conflicts, re-run tests
git pull origin develop
git push -u origin feature/FLT-11-flight-search
# open a PR: feature/FLT-11-flight-search -> develop
```

Pull `develop` into your branch regularly, and always right before you push. If the pull reports conflicts, resolve them on your branch, re-run tests and lint, and commit the resolution before pushing. Never push or merge a branch with unresolved conflicts, and never delete a teammate's work to make a conflict go away (ask the team leader if unsure).

### Getting work into `main` (team leader)

Once your change is merged into `develop`, check that everything works there (build, lint, tests, server starts, Swagger loads). When `develop` is verified working:

```bash
git checkout main
git pull origin main
git merge develop        # or merge the develop -> main PR; no conflicts allowed
# re-check, then push
git push origin main
```

If the merge shows conflicts, stop, resolve them carefully without removing anyone's work, re-run the checks, and only then push. Never merge broken code into `main`.

Keep branches small and merge within 1 to 2 days. The submission is `main` at the deadline, so `develop` must be verified and merged into `main` before then.

## Commit Messages (Conventional Commits)

```
feat(auth): implement registration
feat(flights): add round-trip search
fix(hotels): prevent double booking
refactor(payments): simplify refund logic
docs(api): document booking endpoints
```

Never use: `update`, `changes`, `final`, `fix`.

## Pull Requests

Each PR must:
- Have a meaningful title and description
- Reference requirement IDs
- Contain only related changes
- Not contain secrets or `.env` files
- Be reviewed by the team leader, with important comments resolved before merge

## Code Rules

- Backend validation and authorization are mandatory. Frontend checks never replace them.
- Auth tokens live in httpOnly cookies only.
- Do not store raw card data. Stripe test mode only.
- Secrets only in `.env`; update `.env.example` with names (no values) when you add a variable.
- Document every endpoint in Swagger with examples.
- Include loading, error, empty and confirmation states in the UI.

## AI Usage

AI tools are allowed but must be disclosed.
- Log prompts that materially helped in `AI_PROMPTS.txt`.
- Review all AI-generated code before merging; you must be able to explain it.
- Never share passwords, tokens or connection strings with AI tools.

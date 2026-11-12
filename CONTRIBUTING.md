# Contributing Guide

Follow this for every change. The team leader reviews all PRs.

## Branches

- `main`: stable milestone releases only. **Never commit directly.**
- `develop`: integration branch. All work merges here via pull request.
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
git push -u origin feature/FLT-11-flight-search
# open a PR: feature/FLT-11-flight-search -> develop
```

Sync with `develop` regularly (`git pull origin develop` on your branch). Resolve conflicts carefully and never delete a teammate's work.

At milestone release only: `develop` -> `main`.

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

# AGENTS.md: Travel Planning and Booking Platform

Instructions for AI coding agents (Claude Code, Copilot, Codex, etc.) and for humans reviewing their output.

## Project
- Backend: NestJS + Mongoose in `backend/` (feature modules)
- Frontend: Next.js App Router, React, TypeScript in `frontend/`
- Database: MongoDB Atlas (one shared database)
- API docs: Swagger UI at `/api/docs` (Milestone 1 is evaluated through it)
- Payments: Stripe test mode | Exchange rates: FXRatesAPI (backend only)
- Requirements: `docs/requirements/` (official Excel sheet is authoritative) and `specs/travel-platform.md`
- Team plan and ownership: `PROJECT_BREAKDOWN.md`

## Architecture
1. Preserve MVC / separation of concerns.
2. Controllers handle HTTP only; services hold business and database logic.
3. Mongoose schemas define persistence; DTOs (`class-validator`) validate input.
4. The frontend talks to the REST API only; never to MongoDB.
5. Organize backend code in feature modules: auth, users, admin, airlines/flights, flight-bookings, hotels, hotel-bookings, payments, itineraries, blog, notifications, uploads.
6. Do not add out-of-scope features. Optional bonus features come only after mandatory ones.

## Hard rules (graded)
- Backend validation and authorization are mandatory. Frontend checks never replace them.
- Enforce role and ownership checks on every protected endpoint (users never see others' bookings/itineraries; moderators manage only their own provider).
- Auth tokens only in secure httpOnly cookies. Never localStorage/sessionStorage.
- Inventory must be concurrency-safe: flight holds cannot oversell; hotel bookings cannot overlap; multi-room hotel bookings are all-or-nothing.
- A booking is Confirmed only after backend-verified payment (Stripe test mode). Never store raw card data.
- API keys and secrets only in `.env`. Never read, edit, print or commit `.env`, tokens, API keys or connection strings.
- Reference requirement IDs (e.g. `FLT-22`, `HTL-16`, `PAY-01`) in branches, commits, PRs and Swagger.
- Seed data must use the official reference datasets (countries, cities, airports with IANA time zones, attractions) so IDs match the evaluation.

## Quality
- No `any` unless unavoidable and justified.
- Add or update meaningful tests (especially concurrency, refunds, ownership).
- Do not add unnecessary packages.
- Consistent error responses; meaningful loading, error and empty states in the UI.
- Justify Next.js rendering choices (ISR for published posts/public itineraries, dynamic SSR for search/dashboards/bookings, client components for likes/comments).

## Commands (once scaffolded)
Backend:
```bash
cd backend
npm run start:dev
npm test
npm run lint
npm run seed
```
Frontend:
```bash
cd frontend
npm run dev
npm run lint
npm run build
```

## Git workflow
- `main` = milestone releases only. `develop` = integration. Never commit to `main`.
- Branches from latest `develop`: `feature/<REQ-ID>-<description>`, `fix/<REQ-ID>-<description>`, `refactor/<description>`, `docs/<description>`.
- Conventional Commits: `feat(flights): add round-trip search`. Never `update`, `final`, `fix`.
- PRs target `develop` and are reviewed by the team leader.

## AI usage
Log every prompt that materially helped in `AI_PROMPTS.txt` (date, student, tool, requirement, prompt, how output was used). Never put secrets in prompts. Review all AI output; every member must be able to explain their code.

## Workflow
Plan, implement in small steps, verify (tests/lint/Swagger), read the full diff, log AI usage, open PR, review, CI, merge.

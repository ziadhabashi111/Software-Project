# Travel Planning and Booking Platform

Full-stack web platform for flight booking, hotel booking, itinerary planning, budgeting and travel blogging.
Software Project I, Winter 2026, GIU.

- **Backend:** NestJS + MongoDB Atlas (`/backend`)
- **Frontend:** Next.js, React, TypeScript (`/frontend`)
- **Payments:** Stripe (test mode) | **Exchange rates:** FXRatesAPI (via backend only)

Team plan, task split and guidelines: see [PROJECT_BREAKDOWN.md](./PROJECT_BREAKDOWN.md).
Contribution rules: see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Team

| Member | Area |
|---|---|
| Habashi (team lead) | Auth, Accounts, Admin, Audit logs |
| Youssef Wahby | Airlines, Flights, Flight search, Itinerary budgets/FX |
| Yahia Tarek | Flight booking, holds, cancellation |
| Ziad Mohannad | Payments, Refunds, Notifications, Itinerary structure |
| Abdelrahman | Hotel booking, Reviews |
| Amina | Hotels, Rooms, Availability, Hotel search |
| Ahmed Ismail | Blog and community, Seeding, Uploads, Docs |

## Repository Structure

```
.
├── backend/            NestJS API (feature modules)
├── frontend/           Next.js app
├── docs/
│   ├── requirements/   Project PDF and the official Excel requirements sheet
│   └── api/            API documentation notes
├── AI_PROMPTS.txt      Mandatory AI usage log
├── PROJECT_BREAKDOWN.md
├── CONTRIBUTING.md
├── .env.example
└── .gitignore
```

## Getting Started

> Setup steps are filled in as the backend and frontend are scaffolded. Keep this section accurate; it is graded.

```bash
git clone <repo-url>
cd travel-planning-platform

# Environment
cp .env.example backend/.env      # then fill in real values (never commit .env)

# Backend
cd backend
npm install
npm run seed                      # load countries, cities, airports, attractions
npm run start:dev                 # http://localhost:3000, Swagger at /api/docs

# Frontend
cd ../frontend
npm install
npm run dev                       # http://localhost:3001
```

## Environment Variables

See [.env.example](./.env.example). Never commit real values.

## Milestones

| Milestone | Deadline |
|---|---|
| 1: Backend and API (evaluated via Swagger UI) | 20/11/2026 |
| 2: Frontend and integration | 11/12/2026 |

## Requirement Traceability

Requirement IDs (e.g. `ACC-01`, `FLT-22`, `HTL-16`, `PAY-01`, `ITN-21`, `BLG-01`) come from the official Excel sheet and must appear in branch names, commits, PRs and Swagger docs.

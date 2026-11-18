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
| Habashi (team lead) | Auth, Accounts, Admin, Audit logs, Itinerary structure |
| Youssef Wahby | Airlines, Flights, Flight search, Itinerary budgets/FX |
| Yahia Tarek | Flight booking, holds, cancellation |
| Ziad Mohannad | Payments, Refunds, Notifications |
| Abdelrahman | Hotels, Rooms, Availability, Policies |
| Noureldin | Hotel search, Available rooms, Moderator reservations |
| Amina | Hotel booking, Reviews |
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

> Keep this section accurate; it is graded. Prerequisites: Node.js 22 or newer, Git, access to the team MongoDB Atlas cluster (see below), and the [Stripe CLI](https://docs.stripe.com/stripe-cli) if you work on payments.

```bash
git clone https://github.com/ziadhabashi111/Software-Project.git
cd Software-Project
git checkout develop
git checkout -b feature/<REQ-ID>-<description>   # never work directly on develop or main (see CONTRIBUTING.md)

# Backend (there is no package.json in the repo root: run npm inside backend/ and frontend/)
cd backend
cp ../.env.example .env           # then fill in the values below (never commit .env)
npm install
npm run start:dev                 # http://localhost:3000, Swagger at /api/docs
npm run seed                      # reference data: countries, cities, airports, attractions, currencies (see Seeding)
npm run seed:admin                # the administrator from ADMIN_EMAIL / ADMIN_PASSWORD

# Frontend (second terminal)
cd frontend
npm install
# create frontend/.env.local with NEXT_PUBLIC_API_URL and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
npm run dev                       # http://localhost:3001
```

On Windows PowerShell 5 use `;` instead of `&&` to chain commands.

## Environment Variables

Copy `.env.example` to `backend/.env` and fill in every value. Never commit `.env` files, and never paste keys into chat tools or AI assistants: the team leader shares the real values privately.

| Variable | Where | Value / how to get it |
|---|---|---|
| `MONGODB_URI` | `backend/.env` | Shared Atlas string from the team leader, with the database name at the end, e.g. `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/travel-platform` |
| `JWT_SECRET` | `backend/.env` | Your own random string of 16+ characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_EXPIRES_IN`, `PORT`, `NODE_ENV`, `FRONTEND_URL`, `COOKIE_SECURE` | `backend/.env` | Keep the defaults from `.env.example` locally (`COOKIE_SECURE=false` on localhost only) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | `backend/.env` | Used by the seed script to create the administrator. Choose any email; the password must follow the password rule (8+ characters, at least one letter and one digit) |
| `STRIPE_SECRET_KEY` | `backend/.env` | Shared Stripe **test** key (`sk_test_...`) from the team leader |
| `STRIPE_WEBHOOK_SECRET` | `backend/.env` | Per developer, generated on your own machine (it cannot be shared). Install the Stripe CLI (`winget install Stripe.StripeCli`), run `stripe login`, then `stripe listen --forward-to localhost:3000/api/payments/webhook` and copy the `whsec_...` it prints. Only needed for payment work. |
| `FXRATES_API_KEY` | `backend/.env` | Shared FXRatesAPI key from the team leader (backend only, never in the frontend) |
| `FLIGHT_HOLD_MINUTES` | `backend/.env` | `10` (flight and hotel holds both last 10 minutes: FLT-22, HTL-18) |
| `NEXT_PUBLIC_API_URL` | `frontend/.env.local` | `http://localhost:3000/api` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `frontend/.env.local` | Shared Stripe **test** publishable key (`pk_test_...`) |

The backend refuses to start if `MONGODB_URI` or `JWT_SECRET` is missing or still a placeholder. When you add a new variable, add its name (no value) to `.env.example` and a row here. Planned additions: a platform-currency variable (PAY-04, Ziad) and, if the team wants a separate value, a hotel hold duration.

## Seeding (GEN-12)

`npm run seed` (in `backend/`) loads the **official reference datasets** (PDF section 5.1, "Mock Data" sheet) from `docs/requirements/reference-data/` into the database in `MONGODB_URI`:

| File | Collection | Id kept unchanged | Read endpoint |
|---|---|---|---|
| `countries.csv` | `countries` | `code` (e.g. `EG`) | `GET /api/countries?search=` |
| `cities.csv` | `cities` | `city_id` (e.g. `new_york`) | `GET /api/cities?countryCode=&search=` |
| `airports.csv` | `airports` | `iata_code` (e.g. `CAI`), with its IANA `time_zone` | `GET /api/airports` (FLT-02) |
| `attractions.csv` | `attractions` | `attraction_id` (e.g. `att-1`) | none yet |
| (derived) | `currencies` | distinct `currency` codes of `countries.csv` | `GET /api/currencies` |

- **Idempotent:** every record is upserted by its dataset id, so running the seed again never creates duplicates and resets any edited reference record to the dataset values. Nothing is deleted.
- **Checked before writing:** every row needs all its columns. Ids must be unique, and every city, airport and attraction must point to a listed country or city. Each airport's country must match its city's country, and every time zone must be a valid IANA zone. Any error stops the seed and names the file and line.
- **Using the lists in your module:** import `ReferenceDataModule` and inject `ReferenceDataService` (`isCountry`, `isCity`, `isCurrency`). Itinerary countries and day cities (ITN-01, ITN-05) are already checked against them through `PlaceCatalog`.
- If the course publishes new datasets, replace the four CSVs and run `npm run seed` again.

## MongoDB Atlas Access

All members use the same shared Atlas database (`travel-platform`).

**Team leader (Atlas web console), once:**
1. **Security > Network Access > Add IP Address.** Choose **Allow access from anywhere** (`0.0.0.0/0`), because university and home IPs change; or add each member's IP with **Add Current IP Address** (more restrictive, but must be redone whenever an IP changes). Wait 1 to 2 minutes for it to become Active.
2. **Security > Database Access:** make sure the database user (used in `MONGODB_URI`) has the **Read and write to any database** role, or `readWrite` on `travel-platform`.
3. Share the connection string privately. If the password has special characters (`@ : / ?`), URL-encode them in the URI.

**Troubleshooting**

| Symptom | Cause and fix |
|---|---|
| `querySrv ECONNREFUSED _mongodb._tcp...` | Your machine's DNS cannot resolve Atlas SRV records (seen on Windows with some DNS/VPN setups such as WARP). Fix: set your network DNS to `8.8.8.8` / `1.1.1.1`, or in Atlas use **Connect > Drivers** and copy the non-SRV `mongodb://host1,host2,host3/...` string. |
| `MongooseServerSelectionError` / timeout / "Could not connect to any servers" | Your IP is not in Atlas Network Access: ask the team leader to add it (or `0.0.0.0/0`). |
| `bad auth` / `Authentication failed` | Wrong user or password in `MONGODB_URI`, or the password needs URL-encoding. |
| `Invalid environment ... placeholder value` on startup | `backend/.env` still has `<...>` placeholders for `MONGODB_URI` or `JWT_SECRET`. |
| Stripe webhook returns 400 | `STRIPE_WEBHOOK_SECRET` is wrong or missing: run `stripe listen --forward-to localhost:3000/api/payments/webhook` on your own machine, copy the `whsec_...` it prints into your `backend/.env`, and restart the backend. |

## Milestones

| Milestone | Deadline |
|---|---|
| 1: Backend and API (evaluated via Swagger UI) | 20/11/2026 |
| 2: Frontend and integration | 11/12/2026 |

## Requirement Traceability

Requirement IDs (e.g. `ACC-01`, `FLT-22`, `HTL-16`, `PAY-01`, `ITN-21`, `BLG-01`) come from the official Excel sheet and must appear in branch names, commits, PRs and Swagger docs.

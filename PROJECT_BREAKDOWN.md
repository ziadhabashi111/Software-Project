# Travel Planning and Booking Platform: Project Breakdown

**Course:** Software Project I, Winter 2026 (Faculty of Informatics and Computer Science, GIU)
**Instructor:** Dr. Nada Sharaf
**Team (7):** Habashi, Youssef Wahby, Amina, Ziad Mohannad, Ahmed Ismail, Yahia Tarek, Abdelrahman

> The official Excel requirements sheet is the authoritative source for exact business rules, limits and acceptance criteria. This file is the team plan built on top of the project PDF (`docs/requirements/Project_Description.pdf`) and the transcribed requirements (`docs/requirements/REQUIREMENTS.md`). **Every member must read their requirement IDs in the Excel sheet before coding.** Ready-to-paste GitHub issues for every member are in `docs/issues.md`.
>
> **Revision 12/11:** audited against the PDF and every mandatory requirement ID. Appendix A maps every mandatory ID to an owner so nothing is unassigned.

---

## 1. Project Overview

A web-based platform that combines flight booking, hotel booking, itinerary planning, budgeting and travel blogging in one system.

| Actor | What they do |
|---|---|
| Guest | Search flights/hotels, browse public blog posts and itineraries; restricted actions redirect to login and return afterwards (ACC-10) |
| Registered User | Book flights/hotels, manage bookings, build itineraries and budgets, clone public itineraries, write blog posts, comment, like, review hotels, report content |
| Administrator | Create moderators, suspend/reactivate accounts, deactivate/reactivate providers, inspect bookings, handle reports, moderate content, read audit logs (accounts are seeded, no self-registration) |
| Airline Moderator | Manages exactly one airline: profile, flights, cabins, prices, baggage and cancellation policies, bookings and passenger lists |
| Hotel Moderator | Manages exactly one hotel: profile, rooms, availability, prices, policies, reservations |
| System services | Payment confirmation, hold expiry, notifications, exchange rates, booking-state updates, audit logging |

## 2. Goal of the Project

Deliver a complete, working full-stack MVC application that demonstrates:

- A well-designed MongoDB data model with correct relationships
- Role-based authorization and ownership checks (enforced on the backend, not just the UI)
- Consistent booking and inventory handling, including concurrency-safe holds and no double booking
- Stripe test-mode payments, cancellations and policy-based refunds
- Itinerary planning with budgets and currency conversion through FXRatesAPI
- Blog, comments, likes, reports and admin moderation
- Clean integration between the NestJS backend and the Next.js frontend
- Professional Git/GitHub collaboration and transparent AI usage

## 3. Tech Stack and Architecture

- **Model:** MongoDB Atlas (one shared database) + NestJS schemas and services
- **Controller:** NestJS controllers (REST, DTO validation, Swagger)
- **View:** Next.js (React + TypeScript, App Router)
- One NestJS backend, one Next.js frontend, one shared database
- Backend is organized into feature modules: Auth, Users, Admin, Airlines/Flights, FlightBookings, Hotels, HotelBookings, Payments, Itineraries, Blog, Notifications, Uploads (plus Audit and a Reference-data module for countries, cities, airports, currencies)
- Auth tokens (access + refresh) go in **httpOnly, Secure, SameSite cookies**, never localStorage/sessionStorage; the frontend gets the current user from `GET /api/auth/me` (ACC-19)
- Passwords stored only as salted hashes (GEN-13)

### 3.1 Approved packages (install only what is listed; ask the team leader before adding anything else)

The scaffold already has NestJS, Mongoose, Swagger, `class-validator`/`class-transformer`, `cookie-parser`, Jest and ESLint in `backend/`, and Next.js 15 / React 19 in `frontend/`. Still missing:

| Package (install inside `backend/` unless noted) | Who installs | When | Why |
|---|---|---|---|
| `@nestjs/jwt` | Habashi | day 2 | Sign and verify access/refresh tokens |
| `bcryptjs` | Habashi | day 2 | Salted password hashing (pure JS, no native build on Windows) |
| `@nestjs/schedule` | Habashi | day 2 | One shared scheduler for hold expiry, daily FX fetch, flight "Departed" status |
| `csv-parse` | Ahmed | day 2 | Read the official reference CSVs in the seed script (also add an `npm run seed` script) |
| `@types/multer` (dev) | Ahmed | day 2 | Typings for the upload helper (multer itself ships with `@nestjs/platform-express`) |
| `stripe` | Ziad | day 3 | PaymentIntents, Refunds API, webhook signature verification |
| `pdfkit` and `@types/pdfkit` (dev) | Yahia | day 5 | E-ticket PDF (FLT-23) |
| `@stripe/stripe-js`, `@stripe/react-stripe-js` (in `frontend/`) | Ziad | M2 | Stripe Elements so card data never reaches the backend |
| One styling approach (e.g. Tailwind CSS, in `frontend/`) | Ahmed | M2 start | Shared design system (GEN-17); nobody else adds a UI library |
| `nodemailer` and `@types/nodemailer` (dev) | Habashi | bonus | Email notifications, verification and password reset (GEN-01-B, ACC-02, ACC-07) |

No package needed: FXRatesAPI calls (use built-in `fetch`), CSV export (plain string), serving uploaded images (Express static assets on the Nest app), in-app notifications.

Optional dev dependency for the parallel-request tests (Yahia, Amina): `mongodb-memory-server` using a replica set (MongoDB transactions need one), or a separate test database on Atlas.

Tools, not packages: the [Stripe CLI](https://docs.stripe.com/stripe-cli) for webhook testing (Ziad and anyone testing payments).

Always commit `package.json` and `package-lock.json` together. If `package-lock.json` conflicts when you pull, do not hand-edit it: take the version from `develop`, run `npm install`, and commit the result.

## 4. Milestones and Deadlines

| Milestone | Deadline | Scope |
|---|---|---|
| **Milestone 1: Backend & API** | **20/11/2026** | Schemas, modules, auth, REST API, booking/inventory consistency, payments/refunds, itineraries, blog, moderation, Swagger. No frontend needed. Evaluated through Swagger UI. |
| **Milestone 2: Frontend & Integration** | **11/12/2026** | Next.js frontend for all roles (guest, user, airline moderator, hotel moderator, admin), integrated with the backend, loading/error/empty/confirmation states, responsive. |
| Optional bonus | with M2 | Cloud deployment (frontend + backend, evaluated **only** on the deployed version) and the optional features in the Excel sheet (Appendix B) |

The plan was written on 12/11, so Milestone 1 is **8 days away**. Section 11 has a day-by-day plan for both milestones.

---

## 5. Work Split at a Glance

| # | Member | Area | Load |
|---|---|---|---|
| 1 | **Habashi** | Team lead, foundations, Auth, Accounts, Admin, Moderation, Audit logs + Itinerary structure | High |
| 2 | **Youssef Wahby** | Airlines, Flights, Flight status, Flight search + Itinerary budgets/FX + `GET /itineraries/:id/flights` | Medium-High |
| 3 | **Yahia Tarek** | Flight booking (one-way and round-trip), passengers, inventory holds, e-ticket, flight cancellation | High |
| 4 | **Ziad Mohannad** | Payments (Stripe), Refunds, Policy acceptance, Notifications, booking-state rules | High |
| 5 | **Abdelrahman** | Hotels, Rooms, Availability, Policies, Hotel search | Medium |
| 6 | **Amina** | Hotel booking, concurrency, cancellation, Reviews | High |
| 7 | **Ahmed Ismail** | Blog and community, report submission, seeding + reference-data API, upload helper, docs upkeep, M2 frontend shell/design system | **Lightest in M1** |

Ahmed has the easiest backend load by design: Blog is mostly standard CRUD with no concurrency or payments logic. In M2 he also builds the shared frontend shell so the UI is consistent (GEN-14..17). Everyone else carries at least one concurrency, money, or multi-entity integration problem.

### 5.1 Requirements that had no clear owner (now assigned)

| Requirement | Owner | Note |
|---|---|---|
| FLT-30 Flight status (Scheduled / Cancelled / Departed) | Youssef | Departed once departure time passes (computed or scheduled); only Scheduled is searchable, editable, bookable |
| PAY-04 Single platform currency | Ziad | One currency constant in config; all prices, payments and refunds use it |
| GEN-11 Booking lifecycle | Ziad publishes the shared enum/transition rules; Yahia and Amina use them | Pending Payment -> Confirmed -> Completed; Pending Payment -> Expired; Confirmed -> Cancelled. Nothing else. |
| GEN-05 Paginate lists > 10 rows (page size 10) | Habashi provides the shared pagination DTO/helper; everyone uses it | |
| GEN-13 / ACC-18 Salted password hashes, seeded admin | Habashi | |
| ACC-09 Edit profile (name, phone, preferred currency) | Habashi | `PATCH /api/users/me` |
| ACC-10 Guest redirected to login and returned to the action | Habashi (M2) | |
| GEN-06 Flight times in each airport's local time zone | Youssef (search/details) + Yahia (booking/e-ticket) | Store UTC, convert with the airport's IANA zone |
| GEN-09 Report content (post, comment, review, **itinerary**) | Ahmed owns the Report schema and submission endpoint; Habashi owns the admin side | At most one report per user per item |
| GEN-12 Seed reference data incl. supported currencies | Ahmed | Plus read endpoints so other modules get countries, cities, currencies |
| GEN-14..17 UI consistency, usability, feedback, responsiveness | Ahmed builds the shared shell; everyone follows it | M2 |
| GEN-02/03/04/16 Field-level errors, confirm destructive actions, empty states, loading/error states | Everyone, in their own module's UI | |

---

## 6. Detailed Tasks per Member

Common to **every** member, for their own module(s):
- Mongoose schemas + DTOs with validation (reject unknown properties), controller, service, Swagger decorators with request/response examples **and the requirement ID in each endpoint summary**
- Ownership and role checks on every protected endpoint (users never see others' bookings/itineraries; moderators touch only their own provider)
- Consistent error responses with field-level validation messages (GEN-02)
- Every list endpoint paginated with page size 10 by default (GEN-05) using Habashi's shared helper
- Call the shared `NotificationService` (Ziad) and `AuditLogService` (Habashi) where your flows require them; never write your own copies
- Concurrency/money/ownership tests for your riskiest flows
- Reference requirement IDs in branch names, commits, PRs and Swagger
- Log AI prompts in `AI_PROMPTS.txt`
- **M2:** build the Next.js pages for your own module (listed under each person) with loading, error, empty and confirmation states, confirm-before-destructive-action dialogs, and responsive layouts

#### Setup for every member (do this first; if you use an AI assistant, tell it to read this section and your own brief below)

1. Install Node.js 22+. Clone the repo, `git checkout develop`, then `git checkout -b feature/<REQ-ID>-<description>`. Never work directly on `develop` or `main`.
2. There is no `package.json` in the repo root. Run `npm install` inside `backend/` and inside `frontend/`.
3. `cd backend && cp ../.env.example .env`, then fill it using the Environment Variables table in `README.md`. The team leader shares `MONGODB_URI` and the Stripe and FXRates keys privately. Never paste keys into an AI tool and never commit `.env` files. AI assistants must not read, print or edit `.env` files.
4. Work only inside your own module folder (`backend/src/<module>/`) and your own frontend routes. Use only the packages in section 3.1 plus those in your brief; ask the team leader before adding any other package.
5. Before pushing: `git pull origin develop`, resolve conflicts on your own branch, run `npm run lint` and `npm test`, then open a PR into `develop` (never merge with conflicts).
6. Log helpful AI prompts in `AI_PROMPTS.txt` (no secrets). An AI assistant must read `AGENTS.md`, the requirement IDs of its member in `docs/requirements/REQUIREMENTS.md`, and that member's issues in `docs/issues.md` before writing code.

### 🟨 **HABASHI**: Team Lead, Foundations, Auth, Accounts, Admin, Moderation, Audit Logs + Itinerary Structure

> **Brief (for you and your Claude)**
> - **Role:** team lead and owner of the shared foundations; also auth, accounts, admin, moderation, audit logs and itinerary structure. Folders: `auth`, `users`, `admin`, `audit`, `itineraries`.
> - **Install (in `backend/`):** `npm install @nestjs/jwt bcryptjs @nestjs/schedule`. For the email bonuses later: `npm install nodemailer` and `npm install -D @types/nodemailer`.
> - **Most important:** the foundations (guards, roles, ownership helper, pagination helper, error filter, Swagger, `AuditLogService`, scheduler) merged to `develop` by **Fri 13/11**, because every other member is blocked on them. Then lockout (5 failures, 15 min), 30-minute session expiry, and ownership checks.
> - **Others depend on you for:** guards, `@Roles()`, pagination, errors, Swagger, audit log, `isHidden` moderation hooks.
> - **You depend on:** Ahmed (Report schema, upload helper, seed), Yahia and Amina (`hasUpcomingConfirmedBookings`), Youssef and Abdelrahman (`setActive`), Ziad (`NotificationService`), Abdelrahman (hotel search for ITN-25), Youssef (budget data for city-group subtotals).
> - **Team lead:** protect branches, accept/confirm teammates' repo access, review PRs, make sure conflicts never delete a teammate's work.
> - **Bonus (only after your own mandatory issues are merged):** GEN-01-B email notifications (issue 53), ACC-02 email verification (54), ACC-07 password reset by email (55), BON-02 favourites (56), BLG-13 attach an itinerary to a blog post (57), and the cloud deployment (64, 65). See section 15 for the order and dates.

**Milestone 1 (backend)**

*Team lead duties*
- Create the shared MongoDB Atlas DB and share the connection string privately; create `develop` from `main` and turn on branch protection for both (PR + leader review required, no direct pushes); review and merge PRs; verify conflict resolution never deletes a teammate's work; create the GitHub issues from `docs/issues.md`
- Run the day-1 schema-agreement call (agenda in section 8)

*Foundations: merged to `develop` by end of day 2 (Fri 13/11)*
- JWT access + refresh tokens in httpOnly/Secure/SameSite cookies (ACC-19), `AuthGuard`, `RolesGuard`, `@Roles()`, `@CurrentUser()`, a reusable ownership-check helper
- Global validation pipe (whitelist, reject unknown fields) and global exception filter for consistent errors (GEN-02)
- Shared pagination DTO/helper (`page`, `limit`, default 10) returning `{ items, total, page, limit }` (GEN-05)
- Swagger setup with the requirement-ID summary convention
- `AuditLogService` (admin actions: suspensions, reactivations, provider deactivation, deletions, hides, password resets)
- Scheduler module (`@nestjs/schedule`, if not already installed) so hold-expiry and daily-FX jobs share one setup
- Salted password hashing (GEN-13)

*Auth and accounts*
- ACC-01 `POST /api/auth/register`: name, unique email, password (>= 8 chars with at least one letter and one digit), mandatory terms/privacy consent (store consent timestamp); inline field errors
- ACC-04/05 `POST /api/auth/login`: generic "invalid email or password" on failure, distinct "account suspended" message, **lock for 15 minutes after 5 consecutive failures**, successful login resets the counter; response gives the role so the UI can land on the role's home page
- ACC-06 `POST /api/auth/logout`: clear cookies and revoke the refresh token on the server; **session expires after 30 minutes without an authenticated request**
- ACC-08 `PATCH /api/auth/change-password` (current + new password, rules enforced)
- ACC-19 `GET /api/auth/me`
- Temporary-password flow: `mustChangePassword` flag; a user/moderator with a temporary password must set a compliant password at next login (ACC-07a, ACC-13)
- ACC-09/11 `GET`/`PATCH /api/users/me`: edit name, phone, preferred currency (must be in the supported-currency list); save only if every field validates
- ACC-12 `DELETE /api/users/me`: deactivate after confirmation, **blocked while the user has upcoming Confirmed bookings** (needs a query from Yahia/Amina); deactivated users cannot log in, their posts and public itineraries are hidden, their comments and reviews display as "Deleted user"
- ACC-11 ownership rule everywhere: bookings and private itineraries owner-only; admin sees all bookings; moderators see their own provider's bookings
- ACC-18 seed the administrator account (from `ADMIN_EMAIL`/`ADMIN_PASSWORD`); no admin self-registration

*Admin*
- ACC-07a `POST /api/admin/users/:id/reset-password` (temporary password; works for users and moderators)
- ACC-13 `POST /api/admin/moderators`: name, email, role (hotel or airline), linked to exactly one existing provider, temporary password set by admin, must change on first login
- ACC-14 `GET /api/admin/accounts`: paginated; search by name/email; filter by role and status; shows name, email, role, status, registration date
- ACC-15/16 `PATCH /api/admin/accounts/:id/suspend` and `/reactivate` (users and moderators; suspended cannot log in; existing bookings stay valid; content stays visible unless hidden via GEN-10)
- ACC-15 `PATCH /api/admin/providers/:type/:id/deactivate` and `/reactivate` (`:type` = hotel | airline): provider hidden from search and not bookable, **existing Confirmed bookings remain valid**, in-app notification to affected parties (moderator, users with Confirmed bookings). Youssef/Abdelrahman expose `setActive()` and filter on `isActive`.
- ACC-17 `GET /api/admin/bookings`: read-only list of flight and hotel bookings (reference, user, provider, dates, amount, status), filter by type, status, date range

*Moderation and audit*
- GEN-10 `GET /api/admin/reports` (open reports), `PATCH /api/admin/reports/:id` (dismiss / hide content / delete content), `DELETE /api/admin/content/:type/:id` (hide or delete any post, comment, review or itinerary directly). Hidden content is visible only to its author and admins. Agree an `isHidden` flag plus a small `hide/unhide/delete` service method on Ahmed's (posts, comments), Amina's (reviews) and your own (itineraries) modules.
- GEN-07 `GET /api/admin/audit-logs` (paginated): suspensions, deletions, hides, provider deactivation, password resets, report resolutions

*Itinerary structure (ITN-01, 03, 05, 07, 08, 09, 10, 12, 20, 21, 25)*
- ITN-01: `POST/PATCH/DELETE /api/itineraries`: required title (<= 100 chars), one or more countries from the predefined list, start date; **private by default**; delete after confirmation removes it from public search while clones made by others stay intact
- ITN-03: `GET /api/itineraries` (mine, most recently updated first) and `GET /api/itineraries/:id` (owner only)
- ITN-05: `POST/PATCH /api/itineraries/:id/days`: city from the predefined city list, notes; days numbered sequentially, dates derived from start date + day order, **max 60 days**
- ITN-07: `DELETE .../days/:dayId`: renumber, recalculate dates and budget totals (coordinate with Youssef's budget data)
- ITN-08: `PATCH .../days/reorder`: renumber, recalculate dates and city groups
- ITN-09: every day requires a city; consecutive days in the same city are returned as a **group with day count and budget subtotal**
- ITN-10: `POST .../days/:dayId/activities`, `PATCH/DELETE /api/activities/:id`: name, description, optional time, optional cost
- ITN-12: `POST /api/activities/:id/images`, `DELETE .../images/:imageId` through Ahmed's upload helper (GEN-08: JPG/PNG, <= 5 MB, up to 5 per activity)
- ITN-20: public/private visibility via `PATCH /api/itineraries/:id`; setting Private removes it from public search immediately
- ITN-21: `GET /api/itineraries/public/search` (keyword in title, country or city; filter by duration min/max days and country/city), `GET /api/itineraries/public/:id` (read-only: author, days, activities, budget), `POST /api/itineraries/:id/clone` (copies days, activities and budgets; private; credits original author; fully independent)
- ITN-25: `GET /api/itineraries/:id/hotels`: for a chosen city group, search hotels with check-in = first day of the group, check-out = the day after its last day, plus guest count and number of rooms; **reuse Abdelrahman's search (HTL-11)**

**Milestone 2 (frontend):** registration (consent checkbox, inline errors), login (generic, lockout and suspended messages, role-based landing), forced password change, profile (name, phone, preferred currency), change password, account deactivation with confirmation, ACC-10 "login then return to the action", route protection (UI only; backend still enforces); admin dashboard (accounts with search/filter/pagination, create moderator, suspend/reactivate, provider deactivate/reactivate, bookings list with filters, reports queue with dismiss/hide/delete, audit logs); itinerary list and editor (days, city groups with subtotals, activities, images, reorder, visibility), public itinerary search and detail (ISR), clone, hotel suggestions for a city group.

**Mandatory deliverable:** foundations on `develop` by end of day 2 so others can protect their endpoints.

### 🟨 **YOUSSEF WAHBY**: Airlines, Flights, Flight Status, Flight Search + Itinerary Budgets and FX

> **Brief (for you and your Claude)**
> - **Role:** airline and flight data, flight search, flight status, and itinerary budgets with FX conversion. Folders: `flights` (and the budget/FX files that live in `itineraries`; agree the exact folder with Habashi).
> - **Install:** nothing extra. Call FXRatesAPI with Node's built-in `fetch`, build the CSV export by hand, and use Habashi's `@nestjs/schedule` for the daily FX fetch and the "Departed" status.
> - **Most important:** publish the Flight, Cabin and Policy schemas by **Sat 14/11** (Yahia waits on them). Local airport times stored as UTC, correct validations (FLT-03), search availability = total - booked - held, flight cancel refunds 100% via Ziad's `RefundService`, FX with a daily cache, the last cached rates as fallback, and the rate date shown. The FXRates key stays in the backend only.
> - **Others depend on you for:** flight/cabin/policy schemas, `setActive()` on Airline, flight search reused by itineraries.
> - **You depend on:** Yahia (`cancelBookingsForFlight`, `getConfirmedPassengers`), Ziad (`RefundService`, `NotificationService`), Habashi (itinerary and day schemas), Ahmed (upload helper for airline logos, `GET /api/airports` data from the seed).
> - **Bonus (only after your own mandatory issues are merged):** FLT-28 seat selection (issue 59) and ITN-28 itinerary PDF export (issue 60). Do the PDF first. See section 15.

**Milestone 1 (backend)**

*Airlines and flights (FLT-01..06, 08, 09, 17, 29, 30; FLT-02)*
- FLT-01 `POST /api/airlines` (admin), `GET/PATCH /api/airlines/:id` (airline moderator edits own airline: name, code, logo; 1 logo per airline, JPG/PNG <= 5 MB via Ahmed's helper). `isActive` flag for provider deactivation (ACC-15).
- FLT-02 `GET /api/airports`: read-only seeded list (IATA code, name, city, country, IANA time zone); flight creation and search accept only these airports
- FLT-03 `POST /api/flights`: flight number, departure/arrival airports, departure/arrival date-times **entered in each airport's local time and stored in UTC**. Reject: identical airports, arrival not after departure (compared in UTC), departure in the past, duplicate flight number for the same airline on the same departure date.
- FLT-04 `POST /api/flights/:id/cabins`, `PATCH .../cabins/:cabinId`: cabin from {Economy, Premium Economy, Business, First}, each at most once per flight, seat count (whole number > 0), price (> 0), free baggage allowance (bag count) and max weight (kg) per bag
- FLT-05 `PATCH /api/flights/:id`: edit times, cabin prices, cabin seat counts of own **Scheduled** flights. Airports locked once the flight has any booking; seat count cannot drop below booked + held; price changes do not touch existing bookings; **any time change notifies passengers with Confirmed bookings** (via Ziad's `NotificationService`).
- FLT-06 `POST /api/flights/:id/cancel` (after confirmation): status Cancelled, hidden from search, **all Confirmed bookings become Cancelled with a 100% refund** (Ziad's `RefundService`), pending holds released, passengers notified. Yahia exposes `cancelBookingsForFlight(flightId)`; you call it.
- FLT-08 `PUT /api/airlines/:id/baggage-policy`: price per extra bag (> 0), max extra bags per passenger (>= 0); an extra bag has the same max weight as the cabin's free allowance
- FLT-09 `PUT /api/airlines/:id/cancellation-policy`: tiers with unique days-before-departure threshold (integer >= 0) and refund % (0-100). The refund rule (highest threshold not exceeding days remaining; none applies = 0%) lives in Ziad's `RefundService`; you validate and store tiers.
- FLT-17 `GET /api/flights/:id`: airline, number, airports, **local** times, duration, each cabin with price, seats remaining and baggage allowance, airline cancellation policy
- FLT-29 `GET /api/flights/:id/bookings` (reference, passenger names, cabin, seats, status Confirmed/Cancelled; seats remaining per cabin) and `GET /api/flights/:id/passengers/export` (CSV); airline moderator only for own airline's flights
- FLT-30 flight `status`: Scheduled, Cancelled, Departed. A flight becomes Departed once its departure time passes (scheduled job or computed on read). Only Scheduled flights are searchable, editable or bookable.
- Airline moderator restriction: manage **only** their assigned airline

*Flight search (FLT-11, 12, 15; GEN-06)*
- `GET /api/flights/search`: departure airport, arrival airport, departure date (**local date at the departure airport**), number of passengers; list Scheduled flights of **active** airlines whose available seats (total - booked - held) are sufficient; "no flights found" case
- FLT-12: one-way and **round-trip** (outbound + return options), passenger types adult (12+), child (2-11), infant (<2), optional cabin-class filter. Agree with Yahia how infants (10% fare, no seat) and the "at least one adult, infants <= adults" rule are validated so search and booking match.
- FLT-15: inclusive min/max price filter (error if min > max, other criteria preserved), sort by price, duration or departure time, pagination
- GEN-06: all times returned with the airport's IANA zone and local representation

*Itinerary budgets and FX (ITN-14, 16, 18, 26)*
- ITN-14 `POST /api/itineraries/:id/days/:dayId/budgets`, `PATCH/DELETE /api/budgets/:id`: **non-negative** entries per day across food, accommodation, in-city transport, activities, in a selected currency
- ITN-16 `POST /api/itineraries/:id/transport-costs`, `PATCH/DELETE /api/transport-costs/:id`: mode, from-city, to-city, amount, currency, day
- ITN-14/18 `GET /api/itineraries/:id/budget-summary`: total by category and by day; totals include budget entries, **activity costs (counted under Activities)** and intercity transport; converted to the user's preferred/selected currency from the supported list; **shows the rate date**
- ITN-18 FXRatesAPI through the backend only (key in `.env`, never sent to the frontend): fetch rates **once per day**, cache in the database, **fall back to the last cached rates if the API is unavailable**; handle invalid currency codes, missing rates and API failures with clear errors. Booking prices are **not** converted (PAY-04).
- ITN-26 `GET /api/itineraries/:id/flights`: one-way or round-trip from a chosen origin airport to any airport in the city of the itinerary's first day; outbound date defaults to the start date, return date to the last day's date; reuses FLT-11/FLT-12

**Milestone 2 (frontend):** flight search and results (one-way/round-trip toggle, passenger types, cabin, price filter, sort, local times, "no flights found"), flight details page, airline moderator dashboard (airline profile and logo, flights create/edit/cancel with confirmation, cabins, baggage policy, cancellation tiers, bookings per flight, remaining seats, CSV export), itinerary budget UI (entries, transport costs, totals by category/day, currency selector, rate date), flight search from the itinerary.

### 🟨 **YAHIA TAREK**: Flight Booking, Passengers, Inventory Holds, E-ticket, Cancellation

> **Brief (for you and your Claude)**
> - **Role:** everything between "user picks a flight" and "booking confirmed or cancelled": seat holds, passengers, baggage, round-trip, e-ticket, cancellation. Folder: `flight-bookings`.
> - **Install (in `backend/`):** `npm install pdfkit` and `npm install -D @types/pdfkit`. Optional, for the parallel-request test: `npm install -D mongodb-memory-server` (use a replica set, because transactions need one).
> - **Most important:** the seat hold must be atomic so two requests for the last seat never both succeed. It lasts **10 minutes**, then the booking becomes Expired and the seats are released. A round-trip is one booking with two segments, one payment and one reference. Infants pay 10% and take no seat. Nothing becomes Confirmed before Ziad's verified webhook. Write the parallel-request test.
> - **Others depend on you for:** `cancelBookingsForFlight`, `getConfirmedPassengers`, `hasUpcomingConfirmedBookings`, the booking queries for the admin list and FLT-29.
> - **You depend on:** Youssef (flight, cabin and policy schemas, Sat 14/11), Ziad (`PaymentService`, `RefundService`, `NotificationService`, booking-status enum, Sat 14/11).
> - **Bonus (only after your own mandatory issues are merged):** FLT-27 change flight booking (issue 58): reserve the new seats before releasing the old ones, and settle the fare difference through Stripe or a refund. See section 15.

**Milestone 1 (backend)**
- `POST /api/flight-bookings/hold` (FLT-22): **atomically reserve the requested seats only if enough remain**, creating a booking in **Pending Payment** held for **10 minutes**; if payment does not succeed in time the booking becomes **Expired** and the seats are released (scheduled job plus a lazy check on read/pay). Concurrent requests must never book more seats than available. Round-trip holds both segments or neither.
- `POST /api/flight-bookings` (FLT-19, FLT-21): per passenger full name, date of birth, passport/ID number; passenger type derived from date of birth (adult 12+, child 2-11, infant <2) with **infants paying 10% of the fare and occupying no seat**, at least one adult per booking and no more infants than adults; optional extra baggage (bags and weight) per passenger up to the airline's maximum with the fee added to the total; **price snapshot** at booking time; booking summary (flight, passengers, baggage, total) before payment
- FLT-12 round-trip: **one booking with two segments, one payment, one reference**, cancelled as a whole using the **outbound segment's** cancellation tier
- Booking lifecycle (GEN-11, using Ziad's shared enum): Pending Payment -> Confirmed -> Completed; Pending Payment -> Expired; Confirmed -> Cancelled. A Confirmed booking becomes Completed after departure.
- FLT-23: on verified payment (callback from Ziad's webhook handling) set Confirmed, convert held seats to booked, generate a **unique booking reference**, send the in-app notification with booking details, and `GET /api/flight-bookings/:id/e-ticket` returns a **downloadable PDF** e-ticket with local airport times (GEN-06)
- FLT-25 `GET /api/flight-bookings` grouped **Upcoming / Past / Cancelled** (reference, flight, date, passengers, cabin, status) and `GET /api/flight-bookings/:id` with full details including payment and refund status
- FLT-26 `POST /api/flight-bookings/:id/cancel`: own Confirmed booking, any time **before departure** (blocked after), user first sees the **refund amount** from the airline's tiers (provide a preview, e.g. in the booking details or a `GET .../cancel-preview`), booking becomes Cancelled, seats return to inventory, refund created through Ziad's `RefundService`, user notified
- Provider-side hooks used by Youssef: `cancelBookingsForFlight(flightId)` (100% refund, release holds) and `getConfirmedPassengers(flightId)` (for schedule-change notifications); also flight bookings feed `GET /api/flights/:id/bookings` (FLT-29) and the admin bookings list (ACC-17)
- ACC-12 hook for Habashi: `hasUpcomingConfirmedBookings(userId)`
- **Parallel-request test:** two simultaneous requests for the last seat, only one succeeds; hold expiry releases seats
- Optional bonus only after mandatory work is done: change flight (FLT-27), seat selection (FLT-28)

**Milestone 2 (frontend):** passenger and baggage form (types validated against DOB), booking summary, policy acceptance step, hold countdown, my flight bookings (Upcoming/Past/Cancelled), booking details with payment/refund status, cancel flow with refund preview and confirmation dialog, confirmation page, e-ticket download.

### 🟨 **ZIAD MOHANNAD**: Payments, Refunds, Policy Acceptance, Notifications, Booking-State Rules

> **Brief (for you and your Claude)**
> - **Role:** the money and messaging layer used by both booking modules: Stripe payments, refunds, policy acceptance, in-app notifications and the shared booking-status rules. Folders: `payments`, `notifications`.
> - **Install:** backend `npm install stripe`. Frontend (M2) `npm install @stripe/stripe-js @stripe/react-stripe-js` inside `frontend/`. Also install the Stripe CLI (tool, not npm): `winget install Stripe.StripeCli`, then `stripe login`.
> - **Most important:** publish `PaymentService`, `RefundService`, `NotificationService` and the booking-status enum by **Sat 14/11**, because Yahia and Amina are blocked on them. The webhook is the only thing that confirms a booking: verify the Stripe signature on the raw body and handle events idempotently. Refund tier rule (highest threshold not above days remaining, else 0%), one platform currency (PAY-04). No raw card data ever reaches the backend.
> - **Webhook secret:** `STRIPE_WEBHOOK_SECRET` is generated on your own machine by `stripe listen --forward-to localhost:3000/api/payments/webhook` (or `stripe listen --print-secret`). It is per developer and is not shared. The shared test keys come from the team leader.
> - **Others depend on you for:** the three service interfaces, the status enum, refund preview and issue, notification delivery.
> - **You depend on:** Yahia and Amina (confirm/expire callbacks), every module that calls `NotificationService`.
> - **Bonus (only after your own mandatory issues are merged):** BON-01 admin analytics (issue 63): bookings and revenue per provider for a period, with revenue defined net of refunds. See section 15.

**Milestone 1 (backend)**
- **Do first (by end of day 3, Sat 14/11):** publish the `PaymentService`, `RefundService` (`preview()` and `issue()`), `NotificationService.notify(userId, type, message)` interfaces and the shared booking-status enum with allowed transitions (GEN-11) so Yahia and Amina can integrate.
- PAY-01 `POST /api/payments`: pay a **Pending Payment** flight booking or hotel reservation within its hold using Stripe test mode (Elements + PaymentIntents) so card details never reach the backend; reject if the user is not the owner, the hold has expired or **policies are not accepted**; `POST /api/payments/:id/retry` (retry until the hold expires); `GET /api/payments/:id`; **`POST /api/payments/webhook`** verifies the Stripe signature (use the raw request body) and is the only thing that confirms a booking; handle webhooks idempotently; on hold expiry cancel the PaymentIntent; failed or expired payment leaves the booking unconfirmed and releases inventory. Store only the Stripe payment ID, amount, currency and status.
- PAY-02 `GET /api/bookings/:type/:id/policies` (`:type` = flight | hotel; airline cancellation + baggage policies, or hotel cancellation policy + check-in/check-out times) and `POST /api/bookings/:type/:id/accept-policies` (stores acceptance **with a timestamp**; payment blocked until accepted)
- PAY-03 refunds: for every cancellation with a positive refund (user cancellations by the provider's tiers; provider-initiated cancellations at 100%) issue the refund through the **Stripe Refunds API**, record it, expose status **Pending / Refunded / Failed** (webhook-updated) on the booking details, notify the user; `GET /api/refunds/:id`. Tier rule: use the tier with the highest days-before threshold not exceeding the days remaining; none applies = 0%.
- PAY-04: single platform currency from config (pick a Stripe-supported currency); all prices, payments, refunds use it
- GEN-01 notifications: store and serve in-app notifications for booking confirmation, cancellation and refund, flight schedule change, account/provider suspension; `GET /api/notifications` (paginated), `GET /api/notifications/unread-count`, `PATCH /api/notifications/:id/read` (and read-all)
- Provide a Stripe test setup note in the README (Stripe CLI `stripe listen` to obtain `STRIPE_WEBHOOK_SECRET`)

**Milestone 2 (frontend):** payment page with Stripe-hosted fields (no raw card data), policy display and acceptance checkbox, hold countdown, retry on failure, payment and refund status views, notification bell with unread count and list with mark-as-read.

### 🟨 **AMINA**: Hotel Booking, Concurrency, Cancellation, Reviews

> **Brief (for you and your Claude)**
> - **Role:** everything between "user picks rooms" and "reservation confirmed, cancelled or reviewed". Folder: `hotel-bookings` (reviews included).
> - **Install:** nothing required. Optional, for the parallel-request test: `npm install -D mongodb-memory-server` in `backend/` (use a replica set, because transactions need one).
> - **Most important:** publish the Hotel Reservation schema by **Sat 14/11** (Abdelrahman needs it). Multi-room booking is all-or-nothing and no two reservations may overlap, even under parallel requests. The hold lasts **10 minutes**, then Expired. Guests per room respect occupancy, with at least one adult. Cancel the whole reservation only, before check-in. Reviews only after a Completed stay, one per reservation. Write the parallel-request test.
> - **Others depend on you for:** the reservation schema, `hasUpcomingConfirmedBookings`, booking queries for the admin list, reviews and `isHidden` for moderation.
> - **You depend on:** Abdelrahman (hotel, room, availability, policy schemas, Sat 14/11), Ziad (`PaymentService`, `RefundService`, `NotificationService`, status enum).
> - **Bonus (only after your own mandatory issues are merged):** HTL-26 hotel moderator replies to reviews (issue 62). It is the easiest bonus, so do it first. See section 15.

**Milestone 1 (backend)**
- **Publish the hotel reservation schema by end of day 3** (rooms, check-in/out, status, hold expiry): Abdelrahman needs it for availability, search, block rules and the moderator reservations view.
- HTL-16 `POST /api/hotel-bookings`: one or more available rooms of the **same hotel and dates** in one reservation; assign adults and children (ages 0-17) per room, **at least one adult per reservation**, no room above its maximum occupancy; total = sum over rooms of nights x that room's price at booking time (price snapshot)
- HTL-18 hold: all selected rooms held **together for 10 minutes** as one **Pending Payment** reservation. If any room overlaps a Confirmed reservation, an unexpired hold or a blocked range, **the whole request is rejected and nothing is held** (MongoDB transaction or equivalent atomic approach). Unpaid reservations become **Expired** and rooms are released. Check-out must be after check-in; check-in cannot be in the past.
- HTL-17: on verified payment (Ziad's webhook) all rooms go to Confirmed, unique reference, in-app notification, confirmation page data
- HTL-20 `GET /api/hotel-bookings` grouped **Upcoming / Past / Cancelled** (reference, hotel, rooms, dates, guests, total, status) and `GET /api/hotel-bookings/:id` with payment and refund status
- HTL-21 `POST /api/hotel-bookings/:id/cancel`: own Confirmed reservation **as a whole** before check-in (no partial cancellation), refund preview from the hotel's tiers on the full total, all rooms released, refund via Ziad's `RefundService`
- HTL-23 a Confirmed reservation becomes **Completed** after check-out; `POST /api/hotel-bookings/:id/review`: one rating (1-5) plus optional review (<= 1000 chars) per Completed reservation regardless of room count; `PATCH/DELETE /api/reviews/:id`; hotel average rating recalculated
- HTL-24 `GET /api/hotels/:id/reviews`: average rating, number of ratings, reviews newest first, paginated; reviews of deactivated users show "Deleted user" (ACC-12); reviews support `isHidden` for GEN-10 and can be reported (GEN-09)
- Hooks: `hasUpcomingConfirmedBookings(userId)` for Habashi (ACC-12); hotel bookings feed the admin bookings list (ACC-17) and Abdelrahman's reservations view (HTL-22)
- **Parallel-request test:** no overlapping reservations; multi-room request is all-or-nothing
- Optional bonus after mandatory work: moderator replies (HTL-26, `POST /api/reviews/:id/reply`)

**Milestone 2 (frontend):** room selection with guest assignment per room, booking summary and policy acceptance, hold countdown, my hotel bookings (Upcoming/Past/Cancelled), booking details, cancel flow with refund preview and confirmation, review form (rating + text) and review list, hotel moderator reservations view.

### 🟨 **ABDELRAHMAN**: Hotels, Rooms, Availability, Policies, Hotel Search

> **Brief (for you and your Claude)**
> - **Role:** hotel catalogue and inventory data: hotels, rooms, availability and blocked dates, policies, hotel search. Folder: `hotels`.
> - **Install:** nothing extra.
> - **Most important:** publish the Hotel, Room, Availability and Policy schemas by **Sat 14/11** (Amina and Habashi wait on them) and agree the reservation shape with Amina. Availability ranges must not overlap. Blocking, deactivating or deleting a room is rejected if it overlaps a Confirmed or Pending Payment reservation. Search rules: city or country, dates, guests, rooms, combined occupancy, and "free" means no overlap with Confirmed reservations, unexpired holds or blocked ranges. A moderator manages only their own hotel.
> - **Others depend on you for:** the four schemas, `setActive()` on Hotel, hotel search reused by itineraries (ITN-25).
> - **You depend on:** Amina (reservation schema and holds), Ahmed (upload helper for hotel photos, seed data), Ziad (`RefundService` applies your cancellation tiers).
> - **Bonus (only after your own mandatory issues are merged):** ITN-27 link booked flights and hotels to itinerary days (issue 61); coordinate with Habashi (days) and Youssef (budget). See section 15.

**Milestone 1 (backend)**
- **Do first (by end of day 3):** publish the Hotel, Room, Availability and Policy schemas so Amina (hotel booking) and Habashi (itinerary hotels) can build on them; agree the reservation shape with Amina.
- HTL-01 `POST /api/hotels` (admin), `PATCH /api/hotels/:id` (own hotel moderator): name, address, city and country, description, **photos (up to 5, JPG/PNG <= 5 MB via Ahmed's helper)**, star class, amenities. `isActive` flag for provider deactivation (ACC-15).
- HTL-02 `GET /api/hotels/:id`: profile, photos, amenities, check-in/out times, cancellation policy, average rating and reviews (from Amina), available rooms when dates are provided
- HTL-03 `POST /api/hotels/:id/rooms`: room number/name unique within the hotel, type, beds, max occupancy (>= 1), price per night (> 0)
- HTL-04 `POST .../rooms/:roomId/availability`: **non-overlapping** bookable date ranges
- HTL-05 `PATCH .../rooms/:roomId` and `.../availability`: edit beds, occupancy, price, availability; price changes do not affect existing reservations; availability **cannot be removed for dates with Confirmed reservations**
- HTL-06 block date ranges, deactivate or delete a room (`DELETE .../rooms/:roomId`): **rejected if it overlaps any Confirmed or Pending Payment reservation**; deactivated rooms excluded from search; delete only if never reserved
- HTL-08 `GET /api/hotels/:id/availability`: each room's status over a date range: Available, Booked (with reservation reference) or Blocked
- HTL-09/10 `PUT /api/hotels/:id/policies`: check-in/out times and cancellation tiers (unique days-before-check-in threshold >= 0, refund 0-100%, same selection rule as FLT-09)
- HTL-11 `GET /api/hotels/search`: city or country, check-in, check-out, guests, **number of rooms (default 1)**; active hotels with enough rooms free for the whole stay whose **combined max occupancy covers the guests**; validate check-out after check-in and check-in not in the past; "free" means no overlap with Confirmed reservations, unexpired holds or blocked ranges
- HTL-12 filters: inclusive min/max price per night (cheapest qualifying room), minimum average rating (1-5; unrated hotels excluded when set); sort by that price or rating; pagination
- HTL-15 `GET /api/hotels/:id/rooms/available`: all rooms free for the searched dates with type, beds, occupancy, price per night and **total stay price**
- HTL-22 `GET /api/hotels/:id/reservations`: guest, dates, status for own hotel
- Hotel moderator restriction: manage **only** their assigned hotel

**Milestone 2 (frontend):** hotel search and results (rooms count, filters, sort), hotel details page (photos, amenities, policy, reviews, rooms for the searched dates), room selection, hotel moderator dashboard (hotel profile and photos, rooms, availability and blocked dates, per-room status calendar, check-in/out times, cancellation tiers, reservations).

### 🟨 **AHMED ISMAIL**: Blog and Community, Reports, Seeding and Reference Data, Upload Helper, Docs, Frontend Shell

> **Brief (for you and your Claude)**
> - **Role:** blog and community, report submission, the seed script and reference-data endpoints, the shared upload helper, docs upkeep, and in M2 the shared frontend shell and design system. Folders: `blog`, `uploads`, plus a new reference-data/seed folder.
> - **Install (in `backend/`):** `npm install csv-parse` and `npm install -D @types/multer`, and add an `npm run seed` script to `backend/package.json`. In M2, pick one styling approach for `frontend/` (for example Tailwind CSS) and install it once for the whole team.
> - **Most important:** by **Fri 13/11** deliver the seed script (official datasets from the PDF link, IDs unchanged, idempotent), the reference-data endpoints (countries, cities, currencies) and the upload helper (JPG/PNG, max 5 MB, up to 5 images per post/activity/hotel, 1 logo per airline), because everyone else needs them. Then blog rules: one like per user per post, up to 5 tags of 30 characters, search ordered by likes plus comments, and one report per user per item. Own the Report schema and share it with Habashi by Mon 16/11 at the latest.
> - **Others depend on you for:** seed data, upload helper, Report schema, `isHidden` and `hide/unhide/delete` on posts and comments, the shared UI shell in M2.
> - **You depend on:** Habashi (public itineraries for the author page, guards and pagination helper).
> - **Bonus:** none assigned (the bonuses in his area are with Habashi). If your mandatory work and the frontend shell are finished early, ask the team leader for extra work.

**Milestone 1 (backend)**
- **Do first (by end of day 2):** seeding script for **countries, cities, airports (with IANA time zones), attractions** and the **supported currencies** (the currency codes in the countries dataset), using the **official reference datasets linked in the PDF**: the CSVs currently in `docs/requirements/reference-data/` are small samples, replace them with the official files and keep the dataset IDs unchanged (`code`, `city_id`, `iata_code`, `attraction_id`), because the final evaluation uses the same records and IDs. Make the script idempotent. Also expose read endpoints other modules need for the "selected from a predefined list" rules: countries, cities, supported currencies (airports are `GET /api/airports`, owned by Youssef).
- **Shared upload helper (GEN-08), by day 2:** JPG/PNG only, <= 5 MB each, up to **5 images per post, activity or hotel and 1 logo per airline**, stored on the server and served by URL; reject anything outside the limits. Used by Habashi (activity images), Youssef (airline logo), Abdelrahman (hotel photos) and your blog.
- Blog (BLG-01..10, 12):
  - BLG-01 `POST /api/posts`: required title and body, optional tags and images, save as Draft or Publish
  - BLG-02 `GET /api/posts` (paginated, published only, filter by tag) and `GET /api/posts/:id` (title, author, date, body, tags, images, like count, comments); drafts visible only to the author; hidden posts only to author and admins
  - BLG-03 `GET /api/posts/mine` (including drafts; title, status, date, like and comment counts)
  - BLG-04 `PATCH/DELETE /api/posts/:id` (author only)
  - BLG-05 `POST /api/posts/:id/comments` (non-empty, <= 500 chars, published posts only, chronological order); BLG-07 `PATCH/DELETE /api/comments/:id` (own comments)
  - BLG-06 `POST/DELETE /api/posts/:id/like` (**at most one like per user per post**, enforce with a unique index)
  - BLG-08 up to **5 tags, <= 30 chars each**, editable, `GET /api/tags/:tag/posts`
  - BLG-09 search published posts by keyword in title, tags or author name (title, author, date, excerpt, or "no results"), **ordered by interaction score (likes + comments) descending, newest first as tie-breaker**
  - BLG-10 `POST /api/posts/:id/images`, `DELETE /api/posts/:id/images/:imageId`
  - BLG-12 `GET /api/authors/:id`: name, join date, published posts **and public itineraries** (needs Habashi's itinerary module); posts of deactivated authors are hidden (ACC-12)
- GEN-09 report submission (new endpoint, e.g. `POST /api/reports`): a registered user reports a **post, comment, review or itinerary** with a reason, **at most once per item per user**. You own the Report schema; Habashi's admin endpoints read and resolve it.
- Moderation hooks for Habashi: `isHidden` on posts and comments with `hide/unhide/delete` service methods
- Keep `AI_PROMPTS.txt`, `README.md` and `docs/api/` current; collect everyone's endpoints into `docs/api/` before submission

**Milestone 2 (frontend)**
- **Shared shell and design system first (target 23/11):** layout, navigation per role, theme tokens (colors, typography, spacing), shared components (forms with field-level errors, tables with pagination, confirm dialog, empty state, loading and error states, toasts), API client with cookie auth, auth context from `/api/auth/me`. This is GEN-14..17; everyone builds on it. Also set up Next.js metadata/SEO helpers for public pages.
- Blog listing/search (dynamic SSR), published post page (ISR), editor with drafts, author page (ISR), comments and likes (client components), report button, tag pages

---

## 7. Shared Conventions (agree on day 1)

| Topic | Rule |
|---|---|
| Booking lifecycle (GEN-11) | Pending Payment -> Confirmed -> Completed; Pending Payment -> Expired (hold timeout); Confirmed -> Cancelled. These are the only transitions. One shared enum (Ziad). Not "Held/Pending". |
| Hold duration | **10 minutes** for flights (FLT-22) and hotels (HTL-18). Set `FLIGHT_HOLD_MINUTES=10` (the `.env.example` placeholder) and reuse it or add a hotel variable. |
| Platform currency (PAY-04) | One currency for all prices, payments, refunds; chosen once in config. Itinerary budgets are converted separately (ITN-18); booking prices never are. |
| Pagination (GEN-05) | `page` + `limit`, default 10, response `{ items, total, page, limit }`. |
| Time (GEN-06) | Flights stored in UTC; entered, searched and shown in the airport's IANA time zone. Hotel dates are calendar dates. |
| Refund tiers | Highest days-before threshold not exceeding days remaining; none = 0%. One implementation in `RefundService`. Provider-initiated cancellation = 100%. |
| Visibility flags | `isHidden` on Post, Comment, Review, Itinerary (GEN-10); user `status` (active, suspended, deactivated); provider `isActive`. Deactivated users' content: hidden or shown as "Deleted user" (ACC-12). |
| Ownership (ACC-11) | Owner-only bookings and private itineraries; admin reads all bookings; moderators read only their own provider's bookings. Return 403 or 404. |
| Notification types (GEN-01) | Booking confirmation, cancellation and refund, flight schedule change, account/provider suspension. |
| Errors | One response shape from the global exception filter with field-level messages. |
| Swagger | Every endpoint has the requirement ID in its summary, DTO examples and error responses. |

## 8. Dependencies Between Members

| Who needs | From | What | By |
|---|---|---|---|
| Everyone | Habashi | Auth guards, roles decorator, ownership helper, pagination helper, error filter, validation pipe, Swagger setup, `AuditLogService` | Day 2 (Fri 13/11) |
| Everyone | Ahmed | Seed script, reference-data endpoints, upload helper | Day 2 |
| Yahia, Amina | Ziad | `PaymentService`, `RefundService`, `NotificationService`, booking-status enum | Day 3 (Sat 14/11) |
| Yahia | Youssef | Flight, cabin, baggage and cancellation-policy schemas | Day 3 |
| Amina, Habashi | Abdelrahman | Hotel, room, availability, policy schemas | Day 3 |
| Abdelrahman | Amina | Hotel reservation schema (rooms, dates, status, hold expiry) for availability, search, blocking rules and HTL-22 | Day 3 |
| Youssef | Yahia | `cancelBookingsForFlight`, `getConfirmedPassengers`, bookings-per-flight query (FLT-05, FLT-06, FLT-29) | Day 5 |
| Youssef | Habashi | Itinerary and day schemas (budgets hang off days) | Day 1 call |
| Habashi | Youssef | Budget data per day for group subtotals (ITN-09) and cleanup when a day is deleted (ITN-07) | Day 5 |
| Habashi | Yahia, Amina | `hasUpcomingConfirmedBookings(userId)` (ACC-12) and booking lists for the admin bookings view (ACC-17) | Day 6 |
| Habashi | Ahmed, Amina | `isHidden` + `hide/unhide/delete` for posts, comments, reviews (GEN-10); Report schema from Ahmed | Day 5 |
| Habashi | Youssef, Abdelrahman | `isActive` / `setActive()` on Airline and Hotel; search filters on it (ACC-15) | Day 5 |
| Ahmed | Habashi | Public itineraries of an author (BLG-12) | Day 6 |
| Everyone | Ziad | Calling `NotificationService` for their GEN-01 events | ongoing |

**Day-1 call (30 min) agenda:** shared schemas and IDs, booking-status enum and 10-minute hold, platform currency, pagination shape, visibility flags, who owns each cross-module hook above, branch rules (`develop` + `main`: always branch, pull `develop` before pushing, never merge with conflicts). Update `docs/erd.md` afterwards.

## 9. Next.js Rendering Strategy (PDF section 9)

The app must **not** use one rendering strategy; each member justifies theirs in the discussion. Public pages need SEO metadata. Remember to revalidate ISR pages when a post or itinerary is edited, hidden or deleted.

| Page / feature | Strategy | Owner |
|---|---|---|
| Published blog post | ISR / static | Ahmed |
| Blog listing / search | Dynamic SSR | Ahmed |
| Public author page | ISR / static | Ahmed |
| Blog editor / drafts | Dynamic SSR + client components | Ahmed |
| Likes and comments | Client components | Ahmed |
| Public itinerary detail | ISR / static | Habashi |
| Public itinerary search | Dynamic SSR | Habashi |
| Private itinerary detail | Dynamic SSR | Habashi |
| Itinerary editor | Dynamic SSR + client components | Habashi (budget panel: Youssef) |
| User booking pages | Dynamic SSR | Yahia (flights), Amina (hotels) |
| Flight search | Dynamic SSR | Youssef |
| Hotel search | Dynamic SSR | Abdelrahman |
| Admin / moderator dashboards | Dynamic SSR | Habashi (admin), Youssef (airline), Abdelrahman + Amina (hotel) |

---

## 10. Guidelines We Must Follow

### Git and GitHub (PDF section 10)
- **Two long-lived branches, as PDF 10.2 asks: `develop` (integration: everyone's work is pushed here first to check it all works together) and `main` (only verified, working code).** Habashi creates `develop` from `main` on day 1.
- **Always make a branch for every change. Never commit or push straight to `develop` or `main`.** Branch from the latest `develop`: `feature/<REQ-ID>-<description>`, `fix/<REQ-ID>-<description>`, `refactor/<description>`, `docs/<description>`. Examples: `feature/ACC-01-user-registration`, `feature/FLT-11-flight-search`, `fix/FLT-22-seat-hold-race-condition`
- **Pull the latest `develop` into your branch (`git pull origin develop`) before pushing your changes**, then re-run tests and lint
- **Never merge with conflicts.** Resolve every conflict on your own branch first, re-test, then merge. Never delete a teammate's work to resolve one; ask the team leader if unsure. The team leader verifies resolutions do not remove another member's work.
- Open a PR **to `develop`**; it needs a meaningful title and description, requirement IDs, only related changes, no secrets, and **team-leader review** before merge; resolve important review comments first
- **Only when `develop` is verified working** (build, lint, tests, server starts, Swagger loads): the team leader pulls the latest `main`, merges `develop` into it (conflict-free) and re-checks. Never merge broken code into `main`.
- The submission is `main` at each deadline (M1 on 20/11, M2 on 11/12), so `develop` must be verified and merged into `main` before then
- Commit often. Git history must show real contributions from **every** member throughout (a single upload at the end is not acceptable)
- Commit style (Conventional Commits): `feat(flights): add round-trip search`, `fix(hotels): prevent double booking`, `docs(api): document booking endpoints`. Never `update`, `changes`, `final`, `fix`

### Code and security
- Validate everything on the **backend** (DTOs, `class-validator`); frontend validation and route protection do not replace it (GEN-13)
- Enforce ownership and roles in the backend
- Tokens only in httpOnly cookies; never localStorage/sessionStorage
- No raw card data; Stripe test mode only; verify webhook signatures
- API keys (Stripe, FXRatesAPI, JWT secret, Mongo URI) only in `.env`; `.env` is gitignored; keep `.env.example` updated with names only. FXRatesAPI key is backend-only.
- Handle airport time zones correctly; confirm destructive actions in the UI (GEN-03); include loading, error and empty states (GEN-04, GEN-16); field-level validation messages (GEN-02)
- Public pages need SEO metadata; use different rendering strategies (section 9)
- Seed data must use the official reference datasets with unchanged IDs

### AI usage policy (PDF section 11)
- AI tools are allowed, but every member is responsible for all code they submit and must be able to explain it in the discussion
- Log prompts that materially helped in `AI_PROMPTS.txt` (date, student, tool, requirement, prompt, how output was used)
- **Never paste passwords, tokens, API keys or connection strings into an AI tool** (PDF 11.2 d); anything that was pasted must be rotated
- Review AI output before merging. Undisclosed substantial AI work can violate submission regulations

### Priorities
- **Mandatory requirements first.** Bonus features (Appendix B) must not replace mandatory ones

---

## 11. Plans

### Milestone 1 (12/11 to 20/11)

| Day | Focus |
|---|---|
| Thu 12/11 (day 1) | Everyone clones and runs `npm install`. Habashi creates `develop`, protects `develop` and `main`, shares Mongo URI privately, creates GitHub issues from `docs/issues.md`. 30-min schema agreement call (section 8). |
| Fri 13/11 (day 2) | Habashi: auth, guards, pagination helper, error filter, Swagger, `AuditLogService` merged to `develop` by end of day. Ahmed: seed script, reference-data endpoints, upload helper. Others: schemas and basic CRUD. |
| Sat 14/11 (day 3) | Ziad publishes Payment/Refund/Notification interfaces and the status enum. Youssef, Abdelrahman, Amina publish their schemas. Everyone pulls the latest `develop` into their branch. |
| Sun 15/11 | Provider modules (airlines/flights, hotels/rooms/availability) core endpoints; search and filters |
| Mon 16/11 | Booking flows (holds, concurrency) start. Itinerary structure and budgets/FX. |
| Tue 17/11 | Payments integrated with bookings (webhook confirms). Blog complete. Reports submission. |
| Wed 18/11 | Cross-module integration: cancellation and refund paths, flight-cancel cascade, provider deactivation, ACC-12 rules, moderation hide/delete, audit logging |
| Thu 19/11 | Swagger polish, parallel-request tests, README, `AI_PROMPTS.txt`, bug fixing, final PRs merged to `develop`, verify `develop` works end to end |
| Fri 20/11 | **Deadline.** Pull latest `main`, merge verified `develop` into it, verify a fresh clone of `main` runs from the README alone. |

### Milestone 2 (21/11 to 11/12)

| Dates | Focus |
|---|---|
| Sat 21/11 to Mon 23/11 | Ahmed ships the shared shell, design tokens, API client and auth context. Habashi: auth pages. Everyone scaffolds their routes on the shell. |
| Tue 24/11 to Wed 2/12 | Core workflows per module: search, booking, payment, itinerary editor, blog. Deployment rehearsal (section 15). Bonus backends once your own mandatory issues are merged. |
| Thu 3/12 to Wed 9/12 | Moderator and admin dashboards, cancel/refund flows, responsiveness, empty/loading/error states, SEO metadata, rendering strategies. Bonus cutoff and deployment go/no-go on Sat 5/12, code freeze Wed 9/12 (section 15). |
| Thu 10/12 | Final integration, all-roles walkthrough, final README, `AI_PROMPTS.txt` |
| Fri 11/12 | **Deadline.** Merge verified `develop` into `main`; fresh-clone check of `main`. |

---

## 12. Submission Details

**Milestone 1 (20/11), backend must contain:**
- Fully implemented NestJS backend with MongoDB Atlas integration
- Documented REST API in Swagger UI (this is how it is evaluated)
- README with setup instructions (install, `.env`, seed, run)
- Updated `AI_PROMPTS.txt`
- Git history showing contributions from all members

**Milestone 2 (11/12), final submission must contain:**
- Complete Next.js frontend integrated with the backend
- Working mandatory workflows for **all roles** (guest, user, airline moderator, hotel moderator, admin)
- Final README and setup instructions
- Updated `AI_PROMPTS.txt`
- Complete GitHub contribution history

**Repo must also include:** `.env.example`, `.gitignore` (with `.env`), `docs/requirements/`, `docs/api/`.

**Not specified in the PDF:** how the repo is handed in (link, invite, or upload). Ask the TAs/Dr. Nada before 20/11 and make sure the repo is shared with them.

---

## 13. What Each Member Must Do to Pass Evaluation

For **everyone:**
1. Every mandatory requirement ID in your module works end to end in **Swagger UI** (M1) and in the UI (M2)
2. Ownership and role checks work (try another user's booking/itinerary, wrong role, suspended account)
3. Server-side validation rejects bad input with consistent field-level errors
4. Lists are paginated (10 per page) and empty states are friendly
5. You have commits and merged PRs spread across the project timeline, with requirement IDs
6. You have entries in `AI_PROMPTS.txt` for AI help you used
7. You can explain every line of your code and justify your design (schemas, embedding vs references, rendering strategy) in the discussion
8. A fresh clone runs from the README alone

Per member, the thing evaluators will probe hardest:

| Member | Must be able to demo and defend |
|---|---|
| **Habashi** | Lockout after 5 failed logins for 15 minutes, 30-minute session expiry, suspended account blocked, temporary-password forced change, moderator tied to one provider, provider deactivation vs moderator suspension (Confirmed bookings stay valid), deactivation blocked with upcoming bookings, audit logs written for admin actions, hide/delete moderation, merge-conflict handling; day delete/reorder updates numbering, dates, groups and budget; clone keeps attribution, is private and independent |
| **Youssef Wahby** | Airline moderator cannot touch another airline; flight creation validations and UTC storage; flight status Departed/Cancelled hidden from search; flight cancel cascades to 100% refunds; round-trip search with filters/sorting; time zones; FX conversion plus all three failure cases (invalid code, no rate, API down) with the cached fallback and rate date; key never exposed to frontend |
| **Yahia Tarek** | Two simultaneous requests for the last seat: only one succeeds; hold expiry (10 min) releases seats; infant/child/adult rules; round-trip is one booking with one payment; no confirmation before verified payment; policy-based cancellation with refund preview; cancellation blocked after departure |
| **Ziad Mohannad** | Stripe test mode with webhook signature verification and idempotency; failed/expired payment releases inventory and cancels the PaymentIntent; payment blocked until policies accepted; acceptance timestamp stored; refund calculations and Stripe refund status; notifications fire from other modules; single platform currency |
| **Abdelrahman** | Moderator limited to own hotel; non-overlapping availability ranges; blocking rejected over Confirmed/Pending reservations; room status Available/Booked/Blocked; search by destination/dates/guests/rooms with combined occupancy, filters and sorting; deactivated hotel hidden |
| **Amina** | No overlapping reservations under concurrency; multi-room booking is all-or-nothing; hold expiry; guests per room and occupancy limits; review only after a completed stay (one per reservation); whole-reservation cancellation refund by policy |
| **Ahmed Ismail** | Draft vs published visibility; author-only edit/delete; one like per user per post; search ordering by interaction score; tag and author pages; one report per user per item; seed script reproduces the official reference data and IDs; upload validation (type, size, counts); shared shell consistency |

---

## 14. Risks to Watch

- **Concurrency bugs** (holds and overlapping hotel bookings): write a test that fires parallel requests
- **Schema disagreements** discovered late: lock shared schemas on day 1 and day 3
- **Payment/booking coupling** between Ziad, Yahia and Amina: agree on the booking-state machine and the webhook-to-booking callback early; Stripe webhook needs the raw body for signature checks
- **Cross-module hooks forgotten** (ACC-12 booking check, FLT-06 cascade, GEN-10 hide, ACC-15 `isActive`): section 8 lists them all; track each as a checklist item in its issue
- **Direct pushes and conflicted merges:** a bad push to the shared branch breaks everyone. Always branch, pull `develop` before pushing, never merge with conflicts, and keep `develop` and `main` protected
- **Broken code reaching `main`:** only merge `develop` into `main` after `develop` is verified working
- **One big merge at the end:** merge to `develop` (via PR) at least every 1 to 2 days, and `develop` into `main` whenever it is verified
- **ISR serving stale or hidden content:** revalidate public blog/itinerary pages on edit, hide and delete
- **Bonus scope:** 11 bonuses plus deployment is a lot for three weeks that also include the whole frontend. Work in the section 15.1 order and drop unfinished bonuses at the Sat 5/12 cutoff
- **Deployed-only grading:** with the deployment bonus only the deployed version counts, so a broken deployment hurts mandatory marks too. Rehearse early and keep the go/no-go on 5/12 (section 15.4)
- **Leaked secrets:** a committed `.env`, or any key/password pasted into an AI tool or chat, must be rotated immediately

---

## 15. Optional Bonuses and Cloud Deployment Plan

The team wants **all** optional bonuses and the cloud-deployment bonus. The PDF's rule still holds: bonuses never replace mandatory work. **Gate:** a member starts bonus work only after all of their own mandatory issues are merged into `develop` and verified. Each bonus owner also builds that bonus's UI in M2. The GitHub issues are 53 to 65 in `docs/issues.md`.

### 15.1 Bonus work (suggested owners; swap if loads change)

| Issue | ID | Feature | Owner | Notes |
|---|---|---|---|---|
| 62 | HTL-26 | Hotel moderator replies to reviews (`POST /api/reviews/:id/reply`) | Amina | Easiest, do first |
| 57 | BLG-13 | Attach an itinerary to a blog post (`PATCH /api/posts/:id/itinerary`) | Habashi | Decide the privacy rule for private itineraries; coordinate with Ahmed's blog module |
| 56 | BON-02 | Favourites for hotels and public itineraries | Habashi | |
| 60 | ITN-28 | Itinerary PDF export (`GET /api/itineraries/:id/pdf`) | Youssef | Reuse Yahia's `pdfkit` |
| 61 | ITN-27 | Link booked flights and hotels to itinerary days (`POST /api/itineraries/:id/bookings`) | Abdelrahman | Feeds the budget; coordinate with Habashi and Youssef |
| 63 | BON-01 | Admin analytics: bookings and revenue per provider for a period | Ziad | State the revenue definition (net of refunds) in Swagger |
| 53 | GEN-01-B | Email notifications via SMTP (test inbox in dev) | Habashi | Adds `MailService`; Ziad's `NotificationService` calls it |
| 55 | ACC-07 | Forgot/reset password by email (30-minute, single-use link) | Habashi | Needs 53; lives in your auth module |
| 54 | ACC-02 | Email verification, booking blocked until verified | Habashi | Needs 53; lives in your auth module |
| 58 | FLT-27 | Change flight booking (`PATCH /api/flight-bookings/:id/change-flight`) | Yahia | Hard: fare difference through Stripe or refund |
| 59 | FLT-28 | Seat selection (`PATCH /api/flight-bookings/:id/seat`) | Youssef | Hard: seat map per cabin; coordinate with Yahia |
| 64, 65 | Cloud | Deployment rehearsal and final deployment | Habashi | See 15.2 to 15.4 |

Do them in this order (easy first, hardest last). New package for the email bonuses: `nodemailer` and `@types/nodemailer` (Habashi). **Bonus cutoff: Sat 5/12.** Anything unfinished is dropped so the last week goes to polish and deployment checks.

### 15.2 When we deploy

| When | What | Who |
|---|---|---|
| Fri 20/11 | Milestone 1 submitted from `main`, demonstrated locally through Swagger | Everyone |
| Mon 23/11 to Wed 25/11 | **Deployment rehearsal:** deploy the backend and the starter frontend, connect to Atlas, settle the four decisions in 15.3 | Habashi, with Ziad for Stripe |
| Tue 24/11 to Wed 2/12 | Register the Stripe webhook against the deployed backend and test a payment end to end on the deployed URL | Ziad |
| Thu 3/12 | First full deployment of everything on `main`; every member tests their own module on the deployed URL | Habashi, everyone |
| Sat 5/12 | **Go/no-go** for the deployment bonus (see 15.4) and bonus cutoff | Habashi |
| Wed 9/12 | Code freeze; final deployment; all-roles walkthrough on the deployed URL | Everyone |
| Thu 10/12 | Final check from a fresh seed, README and `AI_PROMPTS.txt` | Everyone |
| Fri 11/12 | **Deadline** | |

Suggested hosts (check current prices and limits): frontend on **Vercel**, backend on **Render, Railway or Fly.io** (an always-on instance for the demo), database stays on **Atlas** (already open to `0.0.0.0/0`). Environment variables live in the host dashboards, never in the repo.

### 15.3 Decisions we make later (decision log)

We decide these together when Ziad starts his Stripe work (target Mon 16/11) and implement them at the rehearsal. Record each decision here.

| Topic | Options | Decide when | Owner | Cheap prep now |
|---|---|---|---|---|
| Cookies across two domains | Next.js rewrite so the browser sees one origin (preferred), or `SameSite=None; Secure` with exact CORS origin | Mon 16/11 | Habashi | Read cookie options from env (`COOKIE_SECURE`, `COOKIE_SAMESITE`, optional `COOKIE_DOMAIN`) |
| Uploaded images | Persistent disk/volume on the host, or cloud object storage | Mon 16/11 | Ahmed | Read the upload folder and public base URL from env; keep all file access inside the upload helper |
| Scheduled jobs (hold expiry, daily FX, flight Departed) | Always-on server, or an external trigger | Mon 16/11 | Habashi | Jobs idempotent and also checked lazily on read, so a sleeping server never breaks correctness |
| Stripe webhook | Production endpoint registered in the Stripe dashboard with its own `whsec_` | Mon 16/11, done at the rehearsal | Ziad | Idempotent webhook handler; no dependence on `stripe listen` in the code |
| Hosting providers | See 15.2 | Mon 23/11 | Habashi | |

### 15.4 Go/no-go warning

The PDF says teams applying for the deployment bonus are evaluated **only on the deployed version** (the local version is not considered). A broken deployment would hurt the mandatory marks too. So on Sat 5/12 run the full all-roles walkthrough on the deployed URL. If it fails and cannot be fixed by Wed 9/12, do not apply for the bonus. Ask the TAs or Dr. Nada how a team opts in before the freeze.

## Appendix A: Mandatory Requirement Ownership (nothing unassigned)

| Prefix | IDs and owner |
|---|---|
| ACC | **Habashi:** 01, 04, 05, 06, 07a, 08, 09, 10 (M2), 11, 12, 13, 14, 15, 16, 17, 18, 19 (hooks from Yahia/Amina for 12 and 17; `setActive` from Youssef/Abdelrahman for 15) |
| FLT | **Youssef:** 01, 02, 03, 04, 05, 06, 08, 09, 11, 12 (search side), 15, 17, 29, 30. **Yahia:** 12 (booking side), 19, 21, 22, 23, 25, 26 |
| HTL | **Abdelrahman:** 01, 02, 03, 04, 05, 06, 08, 09, 10, 11, 12, 15, 22. **Amina:** 16, 17, 18, 20, 21, 23, 24 |
| PAY | **Ziad:** 01, 02, 03, 04 |
| ITN | **Habashi:** 01, 03, 05, 07, 08, 09, 10, 12, 20, 21, 25. **Youssef:** 14, 16, 18, 26 |
| BLG | **Ahmed:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 12 |
| GEN | 01 **Ziad**; 02, 03, 04, 16 **everyone (UI)**; 05 **Habashi** helper, everyone uses; 06 **Youssef + Yahia**; 07 **Habashi**; 08 **Ahmed**; 09 **Ahmed** (submit) + **Habashi** (admin); 10 **Habashi**; 11 **Ziad** enum, **Yahia + Amina** apply; 12 **Ahmed**; 13 **Habashi** + everyone; 14, 15, 17 **Ahmed** shell, everyone follows |

## Appendix B: Optional Bonuses (we are doing all of them, only after each member's mandatory work)

Owners, order, issues and the deployment plan are in section 15.

| ID | Feature | Owner |
|---|---|---|
| FLT-27 | Change flight booking | Yahia |
| FLT-28 | Seat selection | Youssef |
| HTL-26 | Hotel moderator review replies | Amina |
| ACC-02, ACC-07, GEN-01-B | Email verification, email password reset, email notifications | Habashi |
| ITN-27 | Link bookings to itinerary days | Abdelrahman |
| ITN-28 | Itinerary PDF export | Youssef |
| BLG-13 | Attach itinerary to post | Habashi |
| BON-01 | Admin analytics | Ziad |
| BON-02 | Favourites | Habashi |
| Cloud deployment | Frontend + backend, graded only on the deployed version | Habashi |

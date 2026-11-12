# Travel Planning and Booking Platform: Project Breakdown

**Course:** Software Project I, Winter 2026 (Faculty of Informatics and Computer Science, GIU)
**Instructor:** Dr. Nada Sharaf
**Team (7):** Habashi, Youssef Wahby, Amina, Ziad Mohannad, Ahmed Ismail, Yahia Tarek, Abdelrahman

> The official Excel requirements sheet is the authoritative source for exact business rules, limits and acceptance criteria. This file is the team plan built on top of the project PDF (`docs/requirements/Project_Description.pdf`). **Every member must read their requirement IDs in the Excel sheet before coding.**

---

## 1. Project Overview

A web-based platform that combines flight booking, hotel booking, itinerary planning, budgeting and travel blogging in one system.

| Actor | What they do |
|---|---|
| Guest | Search flights/hotels, browse public blog posts and itineraries |
| Registered User | Book flights/hotels, manage bookings, build itineraries and budgets, clone public itineraries, write blog posts, comment, like, review hotels, report content |
| Administrator | Create moderators, suspend/reactivate accounts, inspect bookings, handle reports, moderate content, read audit logs (accounts are seeded, no self-registration) |
| Airline Moderator | Manages exactly one airline: profile, flights, cabins, prices, baggage and cancellation policies |
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
- Backend is organized into feature modules: Auth, Users, Admin, Airlines/Flights, FlightBookings, Hotels, HotelBookings, Payments, Itineraries, Blog, Notifications, Uploads
- Auth tokens go in **secure httpOnly cookies**, never localStorage/sessionStorage

## 4. Milestones and Deadlines

| Milestone | Deadline | Scope |
|---|---|---|
| **Milestone 1: Backend & API** | **20/11/2026** | Schemas, modules, auth, REST API, booking/inventory consistency, payments/refunds, itineraries, blog, moderation, Swagger. No frontend needed. Evaluated through Swagger UI. |
| **Milestone 2: Frontend & Integration** | **11/12/2026** | Next.js frontend for all roles, integrated with the backend, loading/error/empty/confirmation states. |
| Optional bonus | with M2 | Cloud deployment (frontend + backend, evaluated only on the deployed version) and the optional features in the Excel sheet |

Today is 12/11, so Milestone 1 is **8 days away**. Section 9 has a day-by-day plan.

---

## 5. Work Split at a Glance

| # | Member | Area | Load |
|---|---|---|---|
| 1 | **Habashi** | Team lead, Auth, Accounts, Admin, Audit logs | Medium-High |
| 2 | **Youssef Wahby** | Airlines, Flights, Flight search + Itinerary budgets/FX | Medium-High |
| 3 | **Yahia Tarek** | Flight booking, inventory holds, flight cancellation | High |
| 4 | **Ziad Mohannad** | Payments (Stripe), Refunds, Policy acceptance, Notifications + Itinerary structure | High |
| 5 | **Abdelrahman** | Hotel booking, concurrency, cancellation, Reviews | High |
| 6 | **Amina** | Hotels, Rooms, Availability, Hotel search | Medium |
| 7 | **Ahmed Ismail** | Blog and community, DB seeding script, shared upload helper, docs upkeep | **Lightest** |

Ahmed has the easiest load by design: Blog is mostly standard CRUD with no concurrency or payments logic. Everyone else carries at least one concurrency, money, or multi-entity integration problem.

---

## 6. Detailed Tasks per Member

Common to **every** member, for their own module(s):
- Mongoose schemas + DTOs with validation, controller, service, Swagger decorators with request/response examples
- Ownership and role checks on every protected endpoint
- Consistent error responses
- Reference requirement IDs in branch names, commits, PRs and Swagger
- Log AI prompts in `AI_PROMPTS.txt`
- **M2:** build the Next.js pages for your own module (listed under each person)

### 🟨 **HABASHI**: Team Lead, Auth, Accounts, Admin, Audit Logs

**Milestone 1 (backend)**
- Repo owner and team leader: create the shared MongoDB Atlas DB, share the connection string privately, review and merge PRs, resolve merge conflicts without deleting teammates' work
- **Do first (by day 2):** shared foundations everyone depends on: JWT + httpOnly cookie auth, `AuthGuard`, `RolesGuard`, `@Roles()` decorator, global validation pipe, global exception filter (consistent errors), Swagger setup, `AuditLogService`
- Auth and accounts (ACC-01, ACC-04..08, ACC-11, ACC-12, ACC-19): `POST /api/auth/register`, `POST /api/auth/login` (password rules, failed-login lockout, session expiry, account status), `POST /api/auth/logout`, `PATCH /api/auth/change-password`, `GET /api/auth/me`, `GET/PATCH/DELETE /api/users/me`
- Admin (ACC-07a, ACC-13..17): `POST /api/admin/users/:id/reset-password`, `POST /api/admin/moderators` (moderator assignment to exactly one provider), `GET /api/admin/accounts`, suspend/reactivate accounts, deactivate/reactivate providers (`/api/admin/providers/:type/:id/...`, hidden from search, existing Confirmed bookings stay valid, in-app notification to affected parties), `GET /api/admin/bookings`
- Moderation and audit (GEN-07, GEN-09, GEN-10): `GET /api/admin/reports`, `PATCH /api/admin/reports/:id` (dismiss/hide/delete), `DELETE /api/admin/content/:type/:id`, `GET /api/admin/audit-logs`
- Seed the administrator account (no admin self-registration)

**Milestone 2 (frontend):** registration, login, profile, change password, account deactivation, route protection (UI only, backend still enforces), admin dashboard (accounts, moderators, bookings, reports, audit logs)

**Mandatory deliverable:** auth/guards available on `develop` by day 2 so others can protect their endpoints.

### 🟨 **YOUSSEF WAHBY**: Airlines, Flights, Flight Search + Itinerary Budgets and FX

**Milestone 1 (backend)**
- Airlines and flights (FLT-01..09, FLT-17, FLT-29): `POST/GET/PATCH /api/airlines`, `GET /api/airports`, `POST/GET/PATCH /api/flights`, `POST /api/flights/:id/cancel`, cabins (`POST/PATCH /api/flights/:id/cabins`), `PUT /api/airlines/:id/baggage-policy`, `PUT /api/airlines/:id/cancellation-policy`, `GET /api/flights/:id/bookings`, `GET /api/flights/:id/passengers/export`
- Airline moderator restriction: manage **only** their assigned airline
- Flight search (FLT-11, FLT-12, FLT-15): `GET /api/flights/search`, one-way and round-trip, passenger types/counts, cabin class, price filter, sorting, pagination; correct airport time zones
- Itinerary budgeting (ITN-14..18): budget entries (food, accommodation, local transport, activities), transport costs, `GET /api/itineraries/:id/budget-summary`
- FXRatesAPI integration through the backend (API key in `.env` only); handle invalid currency codes, unavailable rates and API failures; convert totals to the user's display currency
- `GET /api/itineraries/:id/flights` (ITN-26): reuse flight search from the itinerary

**Milestone 2 (frontend):** flight search and results (filters, sort), airline moderator dashboard (flights, cabins, policies, bookings), itinerary budget UI with currency selector

### 🟨 **YAHIA TAREK**: Flight Booking, Inventory Holds, Cancellation

**Milestone 1 (backend)**
- Flight booking flow (FLT-19..26): `POST /api/flight-bookings/hold`, `POST /api/flight-bookings`, `GET /api/flight-bookings`, `GET /api/flight-bookings/:id`, `POST /api/flight-bookings/:id/cancel`, `GET /api/flight-bookings/:id/e-ticket`
- **Concurrency-safe inventory holds** (FLT-22): concurrent requests must never reserve more seats than available; holds expire after the period in the Excel sheet and release capacity (scheduled job)
- Passengers and baggage details, price snapshot at booking time, unique booking reference, booking states (Held, Pending, Confirmed, Cancelled, Expired)
- Booking becomes Confirmed **only after payment verification** (coordinate with Ziad), then generates the e-ticket
- Cancellation per the airline's policy (refund amount calculated through the shared refund logic from Ziad)
- Optional bonus only after mandatory work is done: change flight (FLT-27), seat selection (FLT-28)

**Milestone 2 (frontend):** passenger/baggage form, booking summary and policy acceptance, my flight bookings, cancel flow with confirmation dialog, e-ticket view

### 🟨 **ZIAD MOHANNAD**: Payments, Refunds, Policy Acceptance, Notifications + Itinerary Structure

**Milestone 1 (backend)**
- Payments with **Stripe test mode** (PAY-01): `POST /api/payments`, `POST /api/payments/:id/retry`, `GET /api/payments/:id`, `POST /api/payments/webhook` (verify the Stripe signature; the backend verifies outcomes before confirming any booking); never store raw card data
- Policies (PAY-02): `GET /api/bookings/:type/:id/policies`, `POST /api/bookings/:type/:id/accept-policies` (store acceptance with timestamp)
- Refunds (PAY-03): refund calculation by the policy applicable to the booking, `GET /api/refunds/:id`; expose a shared `RefundService` that Yahia and Abdelrahman call on cancellation
- Failed or expired payments leave bookings unconfirmed and release inventory
- Shared **in-app notification service** (GEN notifications): `NotificationService.notify(userId, type, message)` that every other module calls; notification list/read endpoints
- **Do first (by day 3):** publish the `PaymentService`/`RefundService`/`NotificationService` interfaces so booking owners can integrate
- Itinerary structure (ITN-01..12, ITN-20..21): itinerary CRUD, ordered days (`POST/PATCH/DELETE /api/itineraries/:id/days`, `PATCH .../days/reorder`), activities, activity images, dates derived from start date + day order, renumbering/budget recalculation on add/delete/reorder, public/private visibility, `GET /api/itineraries/public/search`, `GET /api/itineraries/public/:id`, `POST /api/itineraries/:id/clone` (independent private copy with attribution)
- `GET /api/itineraries/:id/hotels` (ITN-25): reuse Amina's hotel search

**Milestone 2 (frontend):** payment page (Stripe test mode, Stripe-hosted fields so no raw card data), retry, payment/refund status, notification bell and list, itinerary editor (days, activities, reorder), public itinerary search/detail, clone

### 🟨 **ABDELRAHMAN**: Hotel Booking, Concurrency, Cancellation, Reviews

**Milestone 1 (backend)**
- Hotel booking (HTL-16..23): `POST /api/hotel-bookings`, `GET /api/hotel-bookings`, `GET /api/hotel-bookings/:id`, `POST /api/hotel-bookings/:id/cancel`
- **No overlapping reservations** on the same room/dates under concurrent requests; selecting multiple rooms in one hotel must succeed or fail **as one operation** (use a MongoDB transaction or an equivalent atomic approach)
- Total price, policy snapshot, booking states, confirmation only after payment verification (coordinate with Ziad), inventory release on failed/expired payment
- Cancellation per the hotel's policy with refund calculation
- Reviews (HTL-23, HTL-24): `POST /api/hotel-bookings/:id/review`, `PATCH/DELETE /api/reviews/:id`, `GET /api/hotels/:id/reviews`; only eligible completed stays may review
- Optional bonus after mandatory work: moderator replies (HTL-26)

**Milestone 2 (frontend):** booking summary and policy acceptance, my hotel bookings, cancel flow, review form and review list, hotel moderator reservations view

### 🟨 **AMINA**: Hotels, Rooms, Availability, Hotel Search

**Milestone 1 (backend)**
- Hotels and rooms (HTL-01..10, HTL-15, HTL-22): `POST/GET/PATCH /api/hotels`, room CRUD (`/api/hotels/:id/rooms`), `POST/PATCH /api/hotels/:id/rooms/:roomId/availability` (including blocked dates), `GET /api/hotels/:id/availability`, `GET /api/hotels/:id/rooms/available`, `PUT /api/hotels/:id/policies`, `GET /api/hotels/:id/reservations`
- Hotel moderator restriction: manage **only** their assigned hotel
- Hotel search (HTL-11, HTL-12): `GET /api/hotels/search` by destination, dates, guest count, with filtering, sorting, pagination
- **Do first (by day 3):** publish the Hotel, Room, Availability and Policy schemas so Abdelrahman (hotel booking) and Ziad (itinerary hotels) can build on them

**Milestone 2 (frontend):** hotel search and results, room selection, hotel moderator dashboard (hotel profile, rooms, availability, policies, reservations)

### 🟨 **AHMED ISMAIL**: Blog and Community (lightest load), Seeding, Upload Helper, Docs

**Milestone 1 (backend)**
- Blog (BLG-01..12): `POST/GET /api/posts`, `GET /api/posts/:id`, `GET /api/posts/mine`, `PATCH/DELETE /api/posts/:id` (Draft/Published, author-only edit/delete), comments (`POST /api/posts/:id/comments`, `PATCH/DELETE /api/comments/:id`), likes (`POST/DELETE /api/posts/:id/like`, at most one like per user per post), `GET /api/tags/:tag/posts`, `GET /api/authors/:id`, search by text and tags
- Content reporting (GEN-09): endpoint for users to report a post or comment (Habashi handles the admin side)
- **Do first (by day 2):** DB seeding script that loads the official `Countries.csv`, `Cities`, `Airports.csv` (with IANA time zones) and attractions; everyone needs this data, and the final evaluation uses the same reference records and IDs
- Shared image-upload helper with validation (GEN-08): file type/size checks, used by blog posts and itinerary activities (`POST /api/posts/:id/images`, `DELETE /api/posts/:id/images/:imageId`)
- Keep `AI_PROMPTS.txt`, `README.md` and `docs/api/` tidy; collect everyone's endpoints into the API docs before submission

**Milestone 2 (frontend):** blog listing/search, post page, editor with drafts, author page, comments and likes, report button

---

## 7. Dependencies Between Members

| Who needs | From | What |
|---|---|---|
| Everyone | Habashi | Auth guards, roles decorator, error filter, Swagger setup (day 2) |
| Everyone | Ahmed | Seed script for countries, cities, airports, attractions (day 2) |
| Yahia, Abdelrahman | Ziad | `PaymentService`, `RefundService`, `NotificationService` interfaces (day 3) |
| Yahia | Youssef | Flights, cabins and policy schemas (day 3) |
| Abdelrahman, Ziad | Amina | Hotel, room, availability, policy schemas (day 3) |
| Ziad, Youssef | Youssef/Ziad | Itinerary schema shared: agree on it on day 1 |
| Habashi | All | Provider deactivation and notifications touch Flights/Hotels/Bookings |

Agree on schemas on **day 1** in a 30-minute call before anyone writes models.

---

## 8. Guidelines We Must Follow

### Git and GitHub
- Two long-lived branches: `main` (milestone releases only) and `develop` (integration). **Never develop on `main`.**
- Branch from the latest `develop`: `feature/<REQ-ID>-<description>`, `fix/<REQ-ID>-<description>`, `refactor/<description>`, `docs/<description>`. Example: `feature/FLT-22-seat-hold`
- Open a PR to `develop`; it needs a meaningful title and description, requirement IDs, only related changes, no secrets, and **team-leader review** before merge
- Sync your branch with `develop` regularly; resolve conflicts carefully
- Merge `develop` into `main` only at milestone release
- Commit often. Git history must show real contributions from **every** member throughout (a single upload at the end is not acceptable)
- Commit style (Conventional Commits): `feat(flights): add round-trip search`, `fix(hotels): prevent double booking`. Never `update`, `changes`, `final`, `fix`

### Code and security
- Validate everything on the **backend** (DTOs, `class-validator`); frontend validation does not replace it
- Enforce ownership and roles in the backend; route protection in the frontend is not enough
- Tokens only in httpOnly cookies; never localStorage/sessionStorage
- No raw card data; Stripe test mode only
- API keys (Stripe, FXRatesAPI, JWT secret, Mongo URI) only in `.env`; `.env` is gitignored; keep `.env.example` updated with names only
- Handle airport time zones correctly; confirm destructive actions in the UI; include loading, error and empty states
- Use different Next.js rendering strategies and be ready to justify them (ISR for published posts and public itineraries, dynamic SSR for search/dashboards/bookings, client components for likes/comments)
- Public pages need SEO metadata

### AI usage policy
- AI tools are allowed, but every member is responsible for all code they submit and must be able to explain it in the discussion
- Log prompts that materially helped in `AI_PROMPTS.txt` (date, student, tool, requirement, prompt, how output was used)
- Never paste passwords, tokens or connection strings into an AI tool
- Review AI output before merging. Undisclosed substantial AI work can violate submission regulations

### Priorities
- **Mandatory requirements first.** Bonus features (email, seat selection, PDF export, cloud deployment, etc.) must not replace mandatory ones

---

## 9. Plan for Milestone 1 (12/11 to 20/11)

| Day | Focus |
|---|---|
| Thu 12/11 | Push repo, everyone clones, team leader shares Mongo URI privately, 30-min schema agreement call, create GitHub issues per requirement ID |
| Fri 13/11 | Habashi: auth/guards/Swagger/error filter. Ahmed: seed script. Others: schemas and basic CRUD |
| Sat 14/11 | Foundations merged into `develop`. Everyone rebases. Provider modules (flights, hotels) core endpoints |
| Sun 15/11 | Search and filters. Ziad publishes Payment/Refund/Notification interfaces |
| Mon 16/11 | Booking flows (holds, concurrency) start. Itinerary structure and budgets |
| Tue 17/11 | Payments integration with bookings. Blog complete |
| Wed 18/11 | Cross-module integration, cancellation and refund paths, audit logging |
| Thu 19/11 | Swagger polish, concurrency tests, README, `AI_PROMPTS.txt`, bug fixing |
| Fri 20/11 | **Deadline.** Merge `develop` into `main`, verify a fresh clone runs |

Milestone 2 (frontend) runs 21/11 to 11/12: same ownership, each person builds the UI for their own module, with a final integration week.

---

## 10. Submission Details

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

## 11. What Each Member Must Do to Pass Evaluation

For **everyone:**
1. Every mandatory requirement ID in your module works end to end in **Swagger UI** (M1) and in the UI (M2)
2. Ownership and role checks work (try another user's booking/itinerary, wrong role, suspended account)
3. Server-side validation rejects bad input with consistent errors
4. You have commits and merged PRs spread across the project timeline, with requirement IDs
5. You have entries in `AI_PROMPTS.txt` for AI help you used
6. You can explain every line of your code and justify your design (schemas, embedding vs references, rendering strategy) in the discussion
7. A fresh clone runs from the README alone

Per member, the thing evaluators will probe hardest:

| Member | Must be able to demo and defend |
|---|---|
| **Habashi** | Lockout after failed logins, session expiry, suspended account blocked, moderator tied to one provider, provider deactivation vs moderator suspension, audit logs written for admin actions, merge-conflict handling |
| **Youssef Wahby** | Airline moderator cannot touch another airline; round-trip search with filters/sorting; time zones; FX conversion plus all three failure cases (invalid code, no rate, API down); key never exposed to frontend |
| **Yahia Tarek** | Two simultaneous requests for the last seat: only one succeeds; hold expiry releases seats; no confirmation before verified payment; policy-based cancellation |
| **Ziad Mohannad** | Stripe test mode with webhook signature verification; failed/expired payment releases inventory; policy acceptance timestamp stored; refund calculations; notifications fire from other modules; day reorder updates numbering, dates and budget; clone keeps attribution and is private |
| **Abdelrahman** | No overlapping reservations under concurrency; multi-room booking is all-or-nothing; review only after a completed stay; cancellation refund by policy |
| **Amina** | Moderator limited to own hotel; blocked dates and availability; search by destination/dates/guests with filters and sorting; room availability reflects bookings |
| **Ahmed Ismail** | Draft vs published visibility; author-only edit/delete; one like per user per post; tag and author pages; seed script reproduces the official reference data and IDs; upload validation |

---

## 12. Risks to Watch

- **Concurrency bugs** (holds and overlapping hotel bookings): write a test that fires parallel requests
- **Schema disagreements** discovered late: lock shared schemas on day 1
- **Payment/booking coupling** between Ziad, Yahia and Abdelrahman: agree on the booking-state machine early
- **One big merge at the end:** merge to `develop` at least every 1 to 2 days
- **Leaked secrets:** a committed `.env` or Stripe/Mongo credential must be rotated immediately

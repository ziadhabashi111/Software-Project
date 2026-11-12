# Ready-to-Paste GitHub Issues

One issue per work package, grouped by member. Each is small enough for one branch and PR (`feature/<REQ-ID>-<description>`, PRs target `develop`; always branch, pull `develop` before pushing, never merge with conflicts; `develop` goes into `main` once verified working). Copy the acceptance criteria for each requirement ID from the Excel sheet (`docs/requirements/`) into the issue body when you create it. Every issue also implies the common items in `PROJECT_BREAKDOWN.md` section 6: DTO validation and backend-enforced rules (GEN-13), ownership/role checks (ACC-11), field-level errors (GEN-02), pagination at 10 per page (GEN-05), Swagger with requirement IDs, tests, `AI_PROMPTS.txt` entry. Every **M2 UI issue** also covers confirmation before destructive actions (GEN-03), friendly empty states (GEN-04), and loading/error/success feedback with responsive layouts (GEN-16).

Day 1 = Thu 12/11, day 2 = Fri 13/11, day 3 = Sat 14/11. M1 deadline Fri 20/11. M2 deadline Fri 11/12.

Index: Habashi 1-10 | Youssef 11-17 | Yahia 18-23 | Ziad 24-30 | Abdelrahman 31-36 | Amina 37-43 | Ahmed 44-52 | Bonus and deployment 53-65 (start only after your own mandatory issues are merged)

---

# HABASHI

## Issue 1: Repo, branches and team setup (lead)
**Owner:** Habashi | **Milestone:** M1 | **Due:** day 1
- [ ] Create the shared MongoDB Atlas DB; share the connection string privately (never in chat/AI tools)
- [ ] Create `develop` from `main`; protect `develop` and `main` (PR + leader review, no direct pushes); all feature PRs target `develop`
- [ ] When `develop` is verified working: pull latest `main`, merge `develop` into it with no conflicts, re-check (before each deadline at least)
- [ ] Create GitHub issues from this file, assign owners, add milestone labels
- [ ] Run the 30-min schema call (agenda in `PROJECT_BREAKDOWN.md` section 8); update `docs/erd.md`
- [ ] README setup instructions (install, `.env`, seed, run) kept current
- [ ] Share the branch rules with the team: always branch, pull `develop` before pushing, never merge with conflicts (already in `AGENTS.md`, `CONTRIBUTING.md`, PR template)

## Issue 2: Shared foundations (ACC-19, GEN-02, GEN-05, GEN-07, GEN-13)
**Owner:** Habashi | **Milestone:** M1 | **Due:** day 2 (end of Fri 13/11), blocks everyone
- [ ] JWT access + refresh in httpOnly/Secure/SameSite cookies; `AuthGuard`, `RolesGuard`, `@Roles()`, `@CurrentUser()`
- [ ] Reusable ownership-check helper (403/404)
- [ ] Global validation pipe (whitelist, reject unknown fields) + global exception filter with field-level errors
- [ ] Shared pagination DTO/helper: `page`, `limit` (default 10), response `{ items, total, page, limit }`
- [ ] Swagger setup + requirement-ID summary convention
- [ ] `AuditLogService` (action, actor, target, timestamp)
- [ ] Scheduler module (`@nestjs/schedule`) for hold-expiry and daily FX jobs
- [ ] Salted password hashing
- [ ] Install `@nestjs/jwt@^11`, `@nestjs/schedule@^6` and `bcryptjs` in `backend/` (the latest majors are ESM-only for Nest 12; approved list: `PROJECT_BREAKDOWN.md` section 3.1)
- [ ] Read cookie options from env (`COOKIE_SECURE`, `COOKIE_SAMESITE`, optional `COOKIE_DOMAIN`) so deployment needs no code change (see section 15.3)

## Issue 3: Registration, login, session (ACC-01, 04, 05, 06, 08, 19)
**Owner:** Habashi | **Milestone:** M1 | **Due:** day 3
- [ ] `POST /api/auth/register`: name, unique email, password >= 8 chars with a letter and a digit, mandatory consent (store timestamp); reject invalid/duplicate email
- [ ] `POST /api/auth/login`: generic "invalid email or password"; distinct "account suspended"; **lock 15 min after 5 consecutive failures**; success resets counter; returns role for landing page
- [ ] `POST /api/auth/logout`: clear cookies, revoke refresh token server-side
- [ ] Session expires after **30 min** without an authenticated request
- [ ] `PATCH /api/auth/change-password` (current + new, rules enforced)
- [ ] `GET /api/auth/me`
- [ ] `mustChangePassword` flag enforced at next login (temporary passwords)
- [ ] Seed the administrator from `ADMIN_EMAIL`/`ADMIN_PASSWORD` (ACC-18); no admin self-registration

## Issue 4: Profile, ownership, deactivation (ACC-09, 11, 12)
**Owner:** Habashi | **Milestone:** M1 | **Due:** day 6 (needs Yahia/Amina hook)
- [ ] `GET/PATCH /api/users/me`: name, phone, preferred currency (supported list); save only if all fields validate
- [ ] ACC-11 ownership rule applied across modules: owner-only bookings and private itineraries, admin all bookings, moderators own provider only
- [ ] `DELETE /api/users/me` after confirmation; **blocked with upcoming Confirmed bookings** (`hasUpcomingConfirmedBookings`)
- [ ] Deactivated user cannot log in; posts and public itineraries hidden; comments/reviews shown as "Deleted user"

## Issue 5: Admin accounts, moderators, providers, bookings (ACC-07a, 13, 14, 15, 16, 17)
**Owner:** Habashi | **Milestone:** M1 | **Due:** day 5
- [ ] `POST /api/admin/users/:id/reset-password`: temporary password; must change at next login (users and moderators)
- [ ] `POST /api/admin/moderators`: name, email, role, linked to exactly one existing hotel/airline, temporary password, must change on first login
- [ ] `GET /api/admin/accounts`: paginated, search name/email, filter role and status
- [ ] `PATCH /api/admin/accounts/:id/suspend|reactivate` for users and moderators (suspended cannot log in; bookings stay valid)
- [ ] `PATCH /api/admin/providers/:type/:id/deactivate|reactivate` (`hotel`|`airline`): hidden from search, not bookable, Confirmed bookings stay valid, in-app notifications to affected parties
- [ ] `GET /api/admin/bookings`: reference, user, provider, dates, amount, status; filter type, status, date range
- [ ] Every action writes an audit log entry
- Depends on: Youssef/Abdelrahman `setActive()`, Yahia/Amina booking queries, Ziad `NotificationService`

## Issue 6: Moderation and audit logs (GEN-07, GEN-10)
**Owner:** Habashi | **Milestone:** M1 | **Due:** day 6
- [ ] `GET /api/admin/reports` (open reports, paginated), `PATCH /api/admin/reports/:id` (dismiss / hide / delete)
- [ ] `DELETE /api/admin/content/:type/:id`: hide or delete any post, comment, review or itinerary directly
- [ ] Hidden content visible only to author and admins (agree `isHidden` + `hide/unhide/delete` with Ahmed, Amina, own itineraries)
- [ ] `GET /api/admin/audit-logs` (paginated): suspensions, reactivations, provider deactivation, password resets, deletions, hides, report resolutions
- Depends on: Ahmed's Report schema (issue 49)

## Issue 7: Itinerary core: itineraries, days, activities (ITN-01, 03, 05, 07, 08, 09, 10, 12, 20)
**Owner:** Habashi | **Milestone:** M1 | **Due:** day 6
- [ ] `POST/PATCH/DELETE /api/itineraries`: title <= 100 chars, >= 1 country from predefined list, start date; private by default; delete after confirmation (removed from public search, clones unaffected)
- [ ] `GET /api/itineraries` (mine, most recently updated first), `GET /api/itineraries/:id` (owner only)
- [ ] `POST/PATCH/DELETE /api/itineraries/:id/days`: city from predefined list, notes; **max 60 days**; sequential numbering; dates derived from start date + order
- [ ] Delete day: renumber, recalculate dates and budget totals
- [ ] `PATCH /api/itineraries/:id/days/reorder`: renumber, recalculate dates and groups
- [ ] City required per day; consecutive same-city days returned as a **group with day count and budget subtotal** (needs Youssef's budget data)
- [ ] Activities: `POST .../days/:dayId/activities`, `PATCH/DELETE /api/activities/:id` (name, description, optional time, optional cost)
- [ ] Activity images via upload helper: `POST /api/activities/:id/images`, `DELETE .../images/:imageId` (JPG/PNG, <= 5 MB, up to 5)
- [ ] Visibility Public/Private via `PATCH /api/itineraries/:id`; Private removes from public search immediately
- [ ] Tests: reorder/delete recalculation, ownership

## Issue 8: Public itineraries, clone, hotels from itinerary (ITN-21, 25)
**Owner:** Habashi | **Milestone:** M1 | **Due:** day 7
- [ ] `GET /api/itineraries/public/search`: keyword in title, country or city; filter duration min/max days and country/city
- [ ] `GET /api/itineraries/public/:id`: read-only with author, days, activities, budget
- [ ] `POST /api/itineraries/:id/clone`: copies days, activities and budgets; private; credits original author; independent of the original
- [ ] `GET /api/itineraries/:id/hotels`: city group dates (check-in = first day, check-out = day after last day) + guests + rooms; **reuse HTL-11 search**
- [ ] Public itineraries of an author available to Ahmed (BLG-12)

## Issue 9: M2: auth, profile and admin UI
**Owner:** Habashi | **Milestone:** M2 | **Due:** 9/12
- [ ] Registration (consent, inline errors), login (generic/lockout/suspended messages, role landing), forced password change
- [ ] Profile (name, phone, preferred currency), change password, deactivate with confirmation
- [ ] ACC-10: guest hits restricted action -> login -> returned to that action
- [ ] Route protection (UI only; backend enforces)
- [ ] Admin dashboards: accounts (search/filter/pagination), create moderator, suspend/reactivate, provider deactivate/reactivate, bookings list with filters, reports queue (dismiss/hide/delete), audit logs
- [ ] Loading, error, empty states, confirmation dialogs

## Issue 10: M2: itinerary UI
**Owner:** Habashi | **Milestone:** M2 | **Due:** 9/12
- [ ] My itineraries, create/edit/delete with confirmation
- [ ] Editor: days, city groups with subtotals, activities, images, reorder, visibility toggle (dynamic SSR + client components)
- [ ] Public itinerary search (dynamic SSR) and detail (ISR + SEO metadata, revalidate on edit/hide), clone
- [ ] Hotel suggestions for a city group; hosts Youssef's budget panel and flight search

---

# YOUSSEF WAHBY

## Issue 11: Airlines, airports, baggage and cancellation policies (FLT-01, 02, 08, 09)
**Owner:** Youssef Wahby | **Milestone:** M1 | **Due:** day 4
- [ ] `POST /api/airlines` (admin), `GET/PATCH /api/airlines/:id` (own airline moderator): name, code, logo (1 logo, JPG/PNG <= 5 MB via upload helper)
- [ ] `isActive` flag + `setActive()` for provider deactivation; deactivated airline hidden from search, not bookable
- [ ] `GET /api/airports`: read-only list (IATA, name, city, country, IANA zone); flights and search accept only these
- [ ] `PUT /api/airlines/:id/baggage-policy`: extra-bag price > 0, max extra bags >= 0, same max weight as cabin allowance
- [ ] `PUT /api/airlines/:id/cancellation-policy`: tiers with unique days-before threshold (int >= 0), refund 0-100%
- [ ] Moderator limited to own airline
- [ ] Publish flight/cabin/policy schemas by **day 3** (Yahia depends on them)

## Issue 12: Flights, cabins, flight status (FLT-03, 04, 05, 30)
**Owner:** Youssef Wahby | **Milestone:** M1 | **Due:** day 5
- [ ] `POST /api/flights`: local departure/arrival times stored as UTC; reject identical airports, arrival not after departure (UTC), departure in the past, duplicate flight number for same airline and departure date
- [ ] Cabins `POST /api/flights/:id/cabins`, `PATCH .../cabins/:cabinId`: {Economy, Premium Economy, Business, First}, each once per flight, seats whole number > 0, price > 0, free bags, max kg per bag
- [ ] `PATCH /api/flights/:id` for Scheduled flights: airports locked once booked; seat count not below booked + held; price changes leave existing bookings; **time change notifies Confirmed passengers**
- [ ] **FLT-30 status** Scheduled / Cancelled / Departed (Departed after departure time); only Scheduled searchable, editable, bookable
- [ ] Moderator limited to own airline's flights

## Issue 13: Flight cancellation and moderator booking views (FLT-06, 29)
**Owner:** Youssef Wahby | **Milestone:** M1 | **Due:** day 7
- [ ] `POST /api/flights/:id/cancel` after confirmation: status Cancelled, hidden from search, Confirmed bookings -> Cancelled with **100% refund**, holds released, passengers notified
- [ ] `GET /api/flights/:id/bookings`: reference, passenger names, cabin, seats, status (Confirmed/Cancelled), seats remaining per cabin
- [ ] `GET /api/flights/:id/passengers/export`: CSV
- Depends on: Yahia's `cancelBookingsForFlight`, `getConfirmedPassengers`; Ziad's `RefundService`/`NotificationService`

## Issue 14: Flight search and details (FLT-11, 12, 15, 17, GEN-06)
**Owner:** Youssef Wahby | **Milestone:** M1 | **Due:** day 5
- [ ] `GET /api/flights/search`: departure/arrival airport, **local** departure date, passenger count; Scheduled flights of active airlines with enough free seats (total - booked - held); "no flights found"
- [ ] Round-trip (outbound + return options), passenger types adult 12+/child 2-11/infant <2 (infant no seat; at least one adult; infants <= adults), cabin-class filter
- [ ] Min/max price filter (error if min > max, other criteria kept), sort by price/duration/departure time, pagination
- [ ] `GET /api/flights/:id`: airline, number, airports, local times, duration, cabins (price, seats remaining, baggage), cancellation policy
- [ ] All times returned with airport IANA zone and local time
- [ ] Align infant/adult validation with Yahia's booking rules

## Issue 15: Itinerary budgets and transport costs (ITN-14, 16)
**Owner:** Youssef Wahby | **Milestone:** M1 | **Due:** day 6
- [ ] `POST /api/itineraries/:id/days/:dayId/budgets`, `PATCH/DELETE /api/budgets/:id`: non-negative entries for food, accommodation, in-city transport, activities, in a selected currency
- [ ] `POST /api/itineraries/:id/transport-costs`, `PATCH/DELETE /api/transport-costs/:id`: mode, from-city, to-city, amount, currency, day
- [ ] Owner-only; coordinate day-delete cleanup and group subtotals with Habashi
- Depends on: Habashi's itinerary/day schemas (day 1 call)

## Issue 16: FX conversion and budget summary (ITN-14, 18), itinerary flights (ITN-26)
**Owner:** Youssef Wahby | **Milestone:** M1 | **Due:** day 7
- [ ] FXRatesAPI via backend only (key in `.env`, never sent to the frontend)
- [ ] Fetch rates **once per day**, cache in DB, **use last cached rates if API is down**; show **rate date**
- [ ] Handle invalid currency codes, missing rates, API failures with clear errors
- [ ] `GET /api/itineraries/:id/budget-summary`: totals by category and by day; include budget entries, activity costs (under Activities) and intercity transport; convert to user's preferred/selected currency; booking prices never converted
- [ ] `GET /api/itineraries/:id/flights`: origin airport -> any airport in city of day 1; outbound defaults to start date, return to last day's date; reuses FLT-11/12
- [ ] Tests for all three FX failure cases

## Issue 17: M2: flights, airline dashboard, budget UI
**Owner:** Youssef Wahby | **Milestone:** M2 | **Due:** 9/12
- [ ] Flight search/results (one-way/round-trip, passengers, cabin, price filter, sort, local times, empty state) and details page
- [ ] Airline moderator dashboard: airline profile/logo, flights create/edit/cancel (confirm), cabins, baggage policy, cancellation tiers, bookings per flight, remaining seats, CSV export
- [ ] Itinerary budget UI: entries, transport costs, totals by category/day, currency selector, rate date
- [ ] Flight search from the itinerary

---

# YAHIA TAREK

## Issue 18: Concurrency-safe flight holds (FLT-22, GEN-11)
**Owner:** Yahia Tarek | **Milestone:** M1 | **Due:** day 6
- [ ] `POST /api/flight-bookings/hold`: atomically reserve seats only if enough remain; booking **Pending Payment** held **10 minutes**
- [ ] Expiry: scheduled job + lazy check; unpaid -> **Expired**, seats released
- [ ] Round-trip: both segments held or neither
- [ ] Booking states per GEN-11 using Ziad's shared enum (Pending Payment, Confirmed, Completed, Expired, Cancelled)
- [ ] **Parallel-request test:** two requests for the last seat, only one succeeds; test hold expiry

## Issue 19: Passengers, baggage, summary, round-trip (FLT-12, 19, 21)
**Owner:** Yahia Tarek | **Milestone:** M1 | **Due:** day 6
- [ ] Passenger full name, date of birth, passport/ID number; type derived from DOB (adult 12+, child 2-11, infant <2)
- [ ] Infants pay 10% of fare, occupy no seat; at least one adult; infants <= adults
- [ ] Extra baggage per passenger up to airline max; fee added to total
- [ ] Price snapshot at booking; booking summary (flight, passengers, baggage, total) before payment
- [ ] Round-trip: **one booking, two segments, one payment, one reference**

## Issue 20: Confirmation, reference, e-ticket (FLT-23, GEN-06)
**Owner:** Yahia Tarek | **Milestone:** M1 | **Due:** day 7
- [ ] On verified payment (Ziad's webhook): Confirmed, held seats -> booked, unique booking reference, in-app notification with details
- [ ] `GET /api/flight-bookings/:id/e-ticket`: downloadable PDF with local airport times
- [ ] Nothing is Confirmed before verified payment
- [ ] Install `pdfkit` and `@types/pdfkit` (dev) in `backend/`

## Issue 21: My bookings and cancellation (FLT-25, 26)
**Owner:** Yahia Tarek | **Milestone:** M1 | **Due:** day 7
- [ ] `GET /api/flight-bookings` grouped Upcoming / Past / Cancelled; `GET /api/flight-bookings/:id` full details incl. payment and refund status
- [ ] Confirmed booking becomes Completed after departure
- [ ] `POST /api/flight-bookings/:id/cancel`: own Confirmed booking, before departure only; **refund preview** from airline tiers (FLT-09); Cancelled, seats returned, refund via `RefundService`, user notified
- [ ] Owner-only access (403/404)

## Issue 22: Cross-module hooks and tests for flight booking
**Owner:** Yahia Tarek | **Milestone:** M1 | **Due:** day 6
- [ ] `cancelBookingsForFlight(flightId)` (100% refund, release holds) for Youssef (FLT-06)
- [ ] `getConfirmedPassengers(flightId)` for schedule-change notifications (FLT-05)
- [ ] `hasUpcomingConfirmedBookings(userId)` for Habashi (ACC-12)
- [ ] Booking list/query for admin bookings (ACC-17) and flight bookings view (FLT-29)
- [ ] Tests: ownership, expired hold, cancellation after departure rejected, refund tiers

## Issue 23: M2: flight booking UI
**Owner:** Yahia Tarek | **Milestone:** M2 | **Due:** 9/12
- [ ] Passenger/baggage form (type validated against DOB), booking summary, policy acceptance step, hold countdown
- [ ] My flight bookings (Upcoming/Past/Cancelled), details with payment/refund status
- [ ] Cancel flow with refund preview and confirmation dialog; confirmation page; e-ticket download
- [ ] Dynamic SSR for booking pages

---

# ZIAD MOHANNAD

## Issue 24: Shared service interfaces and booking-state enum (GEN-11)
**Owner:** Ziad Mohannad | **Milestone:** M1 | **Due:** **day 3 (end of Sat 14/11)**, blocks Yahia and Amina
- [ ] Publish `PaymentService`, `RefundService` (`preview()`, `issue()`), `NotificationService.notify(userId, type, message)` interfaces
- [ ] Shared booking-status enum + allowed transitions: Pending Payment -> Confirmed -> Completed; Pending Payment -> Expired; Confirmed -> Cancelled
- [ ] Short usage note for Yahia and Amina

## Issue 25: Stripe payments and webhook (PAY-01)
**Owner:** Ziad Mohannad | **Milestone:** M1 | **Due:** day 6
- [ ] `POST /api/payments` (Stripe test mode, PaymentIntents; no card data reaches the backend); owner-only; rejects expired holds and unaccepted policies
- [ ] `POST /api/payments/:id/retry` until hold expires; `GET /api/payments/:id`
- [ ] `POST /api/payments/webhook`: verify Stripe signature (raw body), idempotent; **only the verified webhook confirms** a booking
- [ ] Failed/expired payment: booking not confirmed, inventory released, PaymentIntent cancelled on hold expiry
- [ ] Store only Stripe payment ID, amount, currency, status
- [ ] README note: Stripe CLI `stripe listen` for `STRIPE_WEBHOOK_SECRET`
- [ ] Install `stripe` in `backend/`; each developer needs their own `STRIPE_WEBHOOK_SECRET` from `stripe listen`

## Issue 26: Policy view and acceptance (PAY-02)
**Owner:** Ziad Mohannad | **Milestone:** M1 | **Due:** day 6
- [ ] `GET /api/bookings/:type/:id/policies` (`flight`|`hotel`): airline cancellation + baggage policies / hotel cancellation policy + check-in/out times
- [ ] `POST /api/bookings/:type/:id/accept-policies`: stores acceptance **with timestamp**; payment blocked until accepted

## Issue 27: Refunds (PAY-03)
**Owner:** Ziad Mohannad | **Milestone:** M1 | **Due:** day 7
- [ ] Tier rule: highest days-before threshold not exceeding days remaining; none applies = 0%
- [ ] `RefundService.preview()` for the cancel dialogs; `issue()` through the **Stripe Refunds API** for any positive amount
- [ ] Provider-initiated cancellations refund 100%
- [ ] Status Pending / Refunded / Failed (webhook-updated) shown on booking details; `GET /api/refunds/:id`
- [ ] Refund notification to the user

## Issue 28: In-app notifications (GEN-01)
**Owner:** Ziad Mohannad | **Milestone:** M1 | **Due:** day 4 (service), day 7 (all events wired)
- [ ] Types: booking confirmation, cancellation and refund, flight schedule change, account/provider suspension
- [ ] `GET /api/notifications` (paginated), `GET /api/notifications/unread-count`, `PATCH /api/notifications/:id/read`, read-all
- [ ] Verify every other module's events fire (booking, cancellation, schedule change, suspension, provider deactivation)

## Issue 29: Platform currency (PAY-04)
**Owner:** Ziad Mohannad | **Milestone:** M1 | **Due:** day 3
- [ ] Single platform currency in config (Stripe-supported); all prices, payments and refunds use it
- [ ] Documented in README; booking prices never converted by the FX module

## Issue 30: M2: payment and notification UI
**Owner:** Ziad Mohannad | **Milestone:** M2 | **Due:** 9/12
- [ ] Payment page with Stripe-hosted fields (no raw card data), policy display and acceptance checkbox, hold countdown
- [ ] Retry on failure; payment and refund status views
- [ ] Notification bell with unread count, list, mark-as-read

---

# ABDELRAHMAN

## Issue 31: Hotel schemas and profile (HTL-01, 02, 09)
**Owner:** Abdelrahman | **Milestone:** M1 | **Due:** day 3 (schemas), day 5 (endpoints)
- [ ] **Publish Hotel, Room, Availability, Policy schemas by day 3** (Amina, Habashi depend on them); agree reservation shape with Amina
- [ ] `POST /api/hotels` (admin), `PATCH /api/hotels/:id` (own moderator): name, address, city, country, description, star class, amenities
- [ ] Hotel photos via upload helper (up to 5, JPG/PNG <= 5 MB)
- [ ] `GET /api/hotels/:id`: profile, photos, amenities, check-in/out times, cancellation policy, average rating and reviews, available rooms when dates given
- [ ] `isActive` + `setActive()`; deactivated hotel hidden from search, not bookable
- [ ] Check-in/check-out times (HTL-09)

## Issue 32: Rooms and availability (HTL-03, 04, 05, 06, 08)
**Owner:** Abdelrahman | **Milestone:** M1 | **Due:** day 6
- [ ] `POST /api/hotels/:id/rooms`: number/name unique in hotel, type, beds, max occupancy >= 1, price/night > 0
- [ ] `POST .../rooms/:roomId/availability`: **non-overlapping** bookable ranges
- [ ] `PATCH` room and availability: price changes do not affect existing reservations; availability cannot be removed for Confirmed reservation dates
- [ ] Block date ranges, deactivate, `DELETE` room: **rejected if overlapping any Confirmed or Pending Payment reservation**; deactivated rooms excluded from search; delete only if never reserved
- [ ] `GET /api/hotels/:id/availability`: per-room status Available / Booked (reference) / Blocked for a date range
- Depends on: Amina's reservation schema (day 3)

## Issue 33: Cancellation tiers (HTL-10)
**Owner:** Abdelrahman | **Milestone:** M1 | **Due:** day 5
- [ ] `PUT /api/hotels/:id/policies`: tiers with unique days-before-check-in threshold (int >= 0), refund 0-100% (same selection rule as FLT-09, evaluated by `RefundService`)
- [ ] Moderator limited to own hotel

## Issue 34: Hotel search and filters (HTL-11, 12)
**Owner:** Abdelrahman | **Milestone:** M1 | **Due:** day 6
- [ ] `GET /api/hotels/search`: city or country, check-in, check-out, guests, **rooms (default 1)**; active hotels with enough rooms free for the **whole stay** and combined max occupancy >= guests
- [ ] "Free" = no overlap with Confirmed reservations, unexpired holds or blocked ranges
- [ ] Validate check-out after check-in, check-in not in the past
- [ ] Filter inclusive min/max price per night (cheapest qualifying room) and min average rating 1-5 (unrated excluded when set); sort by that price or rating; pagination
- [ ] Reusable by Habashi's `GET /api/itineraries/:id/hotels`

## Issue 35: Available rooms and moderator reservations (HTL-15, 22)
**Owner:** Abdelrahman | **Milestone:** M1 | **Due:** day 7
- [ ] `GET /api/hotels/:id/rooms/available`: free rooms for dates with type, beds, occupancy, price/night, **total stay price**
- [ ] `GET /api/hotels/:id/reservations`: guest, dates, status (own hotel only)

## Issue 36: M2: hotel search and moderator dashboard
**Owner:** Abdelrahman | **Milestone:** M2 | **Due:** 9/12
- [ ] Hotel search/results (rooms count, filters, sort), hotel details page, room selection
- [ ] Moderator dashboard: profile/photos, rooms, availability and blocked dates, per-room status view, check-in/out times, cancellation tiers, reservations
- [ ] Dynamic SSR for search and dashboards

---

# AMINA

## Issue 37: Reservation schema and concurrency-safe hold (HTL-18, GEN-11)
**Owner:** Amina | **Milestone:** M1 | **Due:** schema day 3, hold day 6
- [ ] **Publish reservation schema by day 3** (rooms, check-in/out, status, hold expiry): Abdelrahman depends on it
- [ ] Hold all selected rooms **together for 10 minutes** as one Pending Payment reservation
- [ ] If any room overlaps Confirmed, an unexpired hold or a blocked range: **reject the whole request, hold nothing** (transaction or equivalent)
- [ ] Unpaid -> **Expired**, rooms released; check-out after check-in, check-in not in the past
- [ ] **Parallel-request test:** no overlapping reservations; multi-room is all-or-nothing

## Issue 38: Create hotel booking (HTL-16)
**Owner:** Amina | **Milestone:** M1 | **Due:** day 6
- [ ] `POST /api/hotel-bookings`: one or more available rooms, same hotel and dates
- [ ] Adults and children (ages 0-17) assigned per room; **at least one adult** per reservation; no room above max occupancy
- [ ] Total = sum over rooms of nights x that room's price at booking time (snapshot)

## Issue 39: Confirmation and my reservations (HTL-17, 20)
**Owner:** Amina | **Milestone:** M1 | **Due:** day 7
- [ ] On verified payment (Ziad's webhook): all rooms Confirmed, unique reference, in-app notification
- [ ] `GET /api/hotel-bookings` grouped Upcoming / Past / Cancelled; `GET /api/hotel-bookings/:id` incl. payment and refund status
- [ ] Confirmed -> Completed after check-out
- [ ] Owner-only access (403/404)

## Issue 40: Cancel reservation (HTL-21)
**Owner:** Amina | **Milestone:** M1 | **Due:** day 7
- [ ] `POST /api/hotel-bookings/:id/cancel`: own Confirmed reservation **as a whole** before check-in (no partial cancellation)
- [ ] Refund preview from hotel tiers on the full total; rooms released; refund via `RefundService`; user notified

## Issue 41: Reviews (HTL-23, 24)
**Owner:** Amina | **Milestone:** M1 | **Due:** day 7
- [ ] `POST /api/hotel-bookings/:id/review`: one rating 1-5 + optional text <= 1000 chars per **Completed** reservation (regardless of room count)
- [ ] `PATCH/DELETE /api/reviews/:id`; average rating recalculated
- [ ] `GET /api/hotels/:id/reviews`: average, count, newest first, paginated
- [ ] Reviews of deactivated users show "Deleted user"; `isHidden` + `hide/unhide/delete` for GEN-10

## Issue 42: Hooks and tests for hotel booking
**Owner:** Amina | **Milestone:** M1 | **Due:** day 7
- [ ] `hasUpcomingConfirmedBookings(userId)` for Habashi (ACC-12); booking query for admin bookings (ACC-17)
- [ ] Reservation data for Abdelrahman's HTL-22 view
- [ ] Tests: ownership, review only after completed stay, refund tiers, occupancy limits

## Issue 43: M2: hotel booking UI
**Owner:** Amina | **Milestone:** M2 | **Due:** 9/12
- [ ] Room selection with guest assignment per room, booking summary, policy acceptance, hold countdown
- [ ] My hotel bookings (Upcoming/Past/Cancelled), details, cancel flow with refund preview and confirmation
- [ ] Review form (rating + text) and review list
- [ ] Hotel moderator reservations view; dynamic SSR for booking pages

---

# AHMED ISMAIL

## Issue 44: Seed script and reference data (GEN-12)
**Owner:** Ahmed Ismail | **Milestone:** M1 | **Due:** **day 2**, blocks everyone
- [ ] Replace the sample CSVs in `docs/requirements/reference-data/` with the **official datasets** linked in the PDF; keep IDs unchanged (`code`, `city_id`, `iata_code`, `attraction_id`)
- [ ] Install `csv-parse` in `backend/` and add the `seed` script to `backend/package.json`
- [ ] Idempotent `npm run seed` for countries, cities, airports (IANA zones), attractions, **supported currencies** (codes from the countries dataset)
- [ ] Read endpoints for countries, cities, supported currencies (airports are `GET /api/airports`, Youssef)
- [ ] Document seeding in the README

## Issue 45: Shared upload helper (GEN-08)
**Owner:** Ahmed Ismail | **Milestone:** M1 | **Due:** **day 2**
- [ ] JPG/PNG only, <= 5 MB each; up to **5 images per post, activity or hotel**, **1 logo per airline**; stored on the server and served by URL
- [ ] Reject out-of-limit uploads with a clear error
- [ ] Install `@types/multer` (dev) in `backend/`; serve uploaded files with Express static assets (no extra package)
- [ ] Read the upload folder and public base URL from env; keep all file access inside this helper so a persistent disk or cloud storage can replace it at deployment (section 15.3)
- [ ] Usage note for Habashi (activity images), Youssef (airline logo), Abdelrahman (hotel photos)

## Issue 46: Blog posts, drafts, tags, images (BLG-01, 03, 04, 08, 10)
**Owner:** Ahmed Ismail | **Milestone:** M1 | **Due:** day 5
- [ ] `POST /api/posts`: required title and body, optional tags and images, Draft or Published
- [ ] `GET /api/posts/mine` incl. drafts (title, status, date, like and comment counts)
- [ ] `PATCH/DELETE /api/posts/:id` (author only)
- [ ] Up to **5 tags, <= 30 chars each**, editable; `GET /api/tags/:tag/posts`
- [ ] `POST /api/posts/:id/images`, `DELETE .../images/:imageId` (up to 5)

## Issue 47: Comments and likes (BLG-05, 06, 07)
**Owner:** Ahmed Ismail | **Milestone:** M1 | **Due:** day 5
- [ ] `POST /api/posts/:id/comments`: non-empty, <= 500 chars, published posts only, chronological order
- [ ] `PATCH/DELETE /api/comments/:id` (own comments)
- [ ] `POST/DELETE /api/posts/:id/like`: **one like per user per post** (unique index), like count

## Issue 48: Browse, search, author page (BLG-02, 09, 12)
**Owner:** Ahmed Ismail | **Milestone:** M1 | **Due:** day 6
- [ ] `GET /api/posts` paginated, published only, tag filter; `GET /api/posts/:id` (title, author, date, body, tags, images, likes, comments); drafts visible only to author; hidden only to author and admins
- [ ] Search by keyword in title, tags or author name; shows title, author, date, excerpt or "no results"; order by **likes + comments desc, newest first as tie-breaker**
- [ ] `GET /api/authors/:id`: name, join date, published posts **and public itineraries** (needs Habashi, issue 8); deactivated authors hidden

## Issue 49: Report submission (GEN-09)
**Owner:** Ahmed Ismail | **Milestone:** M1 | **Due:** day 4 (schema), day 6 (endpoint)
- [ ] Report schema (target type, target id, reporter, reason, status, timestamps); share with Habashi by day 4
- [ ] `POST /api/reports`: report a **post, comment, review or itinerary** with a reason; **at most once per user per item**
- [ ] `isHidden` and `hide/unhide/delete` methods on posts and comments for Habashi (issue 6)

## Issue 50: Docs upkeep
**Owner:** Ahmed Ismail | **Milestone:** M1 and M2 | **Due:** ongoing; final before 20/11 and 11/12
- [ ] Keep `README.md`, `AI_PROMPTS.txt`, `docs/api/`, `docs/erd.md` current
- [ ] Collect every member's endpoints into `docs/api/` before submission
- [ ] Check each member has `AI_PROMPTS.txt` entries and requirement IDs in commits

## Issue 51: M2: shared frontend shell and design system (GEN-14, 15, 16, 17)
**Owner:** Ahmed Ismail | **Milestone:** M2 | **Due:** **Mon 23/11**, blocks everyone's UI
- [ ] Layout, role-based navigation, theme tokens (colors, typography, spacing)
- [ ] Shared components: forms with field-level errors, tables with pagination, confirm dialog, empty/loading/error states, toasts
- [ ] API client with cookie auth; auth context from `GET /api/auth/me`
- [ ] SEO metadata helpers for public pages; responsive on desktop, tablet, mobile
- [ ] Short usage guide for the team

## Issue 52: M2: blog UI
**Owner:** Ahmed Ismail | **Milestone:** M2 | **Due:** 9/12
- [ ] Blog listing/search (dynamic SSR), published post page (ISR + metadata), author page (ISR), tag pages
- [ ] Editor with drafts (dynamic SSR + client components); likes and comments (client components); report button
- [ ] Revalidate ISR pages on edit, hide, delete

---

# BONUS AND DEPLOYMENT (we are doing all of them, after your own mandatory issues are merged)

Order and owners are in `PROJECT_BREAKDOWN.md` section 15. Bonus cutoff: Sat 5/12. Each issue includes its UI in M2.

## Issue 53: Email service and email notifications (GEN-01-B)
**Owner:** Habashi | **Milestone:** M2 (bonus) | **Due:** 25/11
- [ ] `MailService` with SMTP (install `nodemailer` and `@types/nodemailer`); dev uses a test inbox (e.g. Mailtrap or Ethereal)
- [ ] SMTP variable names added to `.env.example` (names only, no values)
- [ ] Send the GEN-01 notifications by email (booking confirmation, cancellation and refund, flight schedule change, account/provider suspension) plus moderator invitations
- [ ] Ziad's `NotificationService` calls `MailService`; in-app notifications keep working if email fails

## Issue 54: Email verification (ACC-02)
**Owner:** Habashi | **Milestone:** M2 (bonus) | **Due:** 30/11
- [ ] Send a verification link after registration; `GET /api/auth/verify-email`
- [ ] Booking blocked until the email is verified; resend option
- [ ] Changes live in the `auth` module; depends on issue 53

## Issue 55: Forgot and reset password by email (ACC-07)
**Owner:** Habashi | **Milestone:** M2 (bonus) | **Due:** 30/11
- [ ] `POST /api/auth/forgot-password` and `POST /api/auth/reset-password`
- [ ] Link expires after 30 minutes, is single-use, and a newer request invalidates older ones
- [ ] The response never reveals whether the email exists
- [ ] Depends on issue 53

## Issue 56: Favourites (BON-02)
**Owner:** Habashi | **Milestone:** M2 (bonus) | **Due:** 28/11
- [ ] Add, remove and list favourite hotels and public itineraries (owner-only)
- [ ] Hidden, deactivated or private items disappear from the list

## Issue 57: Attach an itinerary to a blog post (BLG-13)
**Owner:** Habashi | **Milestone:** M2 (bonus) | **Due:** 28/11
- [ ] `PATCH /api/posts/:id/itinerary`: the author attaches one of their own itineraries
- [ ] Decide what readers see when the itinerary is private (ITN-20); coordinate with Ahmed's blog module

## Issue 58: Change flight booking (FLT-27)
**Owner:** Yahia Tarek | **Milestone:** M2 (bonus) | **Due:** 3/12
- [ ] `PATCH /api/flight-bookings/:id/change-flight`: change date or flight on a Confirmed booking (same route and cabin), subject to seat availability
- [ ] Reserve the new seats before releasing the old ones (no overselling, parallel-request test)
- [ ] Higher fare: pay the difference through Stripe; lower fare: refund the difference (`RefundService`)

## Issue 59: Seat selection (FLT-28)
**Owner:** Youssef Wahby | **Milestone:** M2 (bonus) | **Due:** 3/12
- [ ] Seat layout per cabin and a seat map endpoint
- [ ] `PATCH /api/flight-bookings/:id/seat`: a seat can belong to only one passenger per flight (unique constraint, concurrency-safe)
- [ ] Coordinate with Yahia's booking module

## Issue 60: Itinerary PDF export (ITN-28)
**Owner:** Youssef Wahby | **Milestone:** M2 (bonus) | **Due:** 28/11
- [ ] `GET /api/itineraries/:id/pdf` for the owner (and public itineraries): title, days, activities, budget
- [ ] Reuse `pdfkit` installed by Yahia; print-friendly download button in the UI

## Issue 61: Link bookings to itinerary days (ITN-27)
**Owner:** Abdelrahman | **Milestone:** M2 (bonus) | **Due:** 30/11
- [ ] `POST /api/itineraries/:id/bookings`: attach the user's own Confirmed flight or hotel bookings to itinerary days
- [ ] Linked bookings feed the budget summary (coordinate with Youssef's FX and Habashi's days)
- [ ] Owner-only for both the itinerary and the booking

## Issue 62: Hotel moderator review replies (HTL-26)
**Owner:** Amina | **Milestone:** M2 (bonus) | **Due:** 25/11
- [ ] `POST /api/reviews/:id/reply`: only the moderator of that hotel; one reply per review
- [ ] Reply shown with the review in `GET /api/hotels/:id/reviews`

## Issue 63: Admin analytics (BON-01)
**Owner:** Ziad Mohannad | **Milestone:** M2 (bonus) | **Due:** 30/11
- [ ] Admin-only endpoint (e.g. `GET /api/admin/analytics`): bookings and revenue per provider over a selected period
- [ ] Define revenue (net of refunds) and document it in Swagger
- [ ] Dashboard in the admin UI

## Issue 64: Deployment rehearsal and the four decisions
**Owner:** Habashi (with Ziad for Stripe) | **Milestone:** M2 (bonus) | **Due:** 25/11
- [ ] Decide and record in `PROJECT_BREAKDOWN.md` section 15.3: cookies across two domains, uploaded images storage, scheduled jobs on the host, Stripe webhook endpoint (start the discussion Mon 16/11)
- [ ] Deploy the backend (Render, Railway or Fly.io) and the starter frontend (Vercel); environment variables set in the dashboards only
- [ ] Connect to Atlas; run the seed once against it
- [ ] Register the Stripe webhook endpoint for the deployed backend and test one payment (Ziad)

## Issue 65: Final deployment and go/no-go
**Owner:** Habashi | **Milestone:** M2 (bonus) | **Due:** go/no-go Sat 5/12, freeze Wed 9/12
- [ ] First full deployment of `main` on Thu 3/12; every member checks their own module on the deployed URL
- [ ] All-roles walkthrough on the deployed URL (guest, user, airline moderator, hotel moderator, admin)
- [ ] Go/no-go on 5/12: the deployed version is the only one graded for the bonus; if it cannot be fixed by 9/12, do not apply
- [ ] Ask the TAs or Dr. Nada how a team opts in to the deployment bonus
- [ ] Final deployment on 9/12 and fresh-seed check on 10/12

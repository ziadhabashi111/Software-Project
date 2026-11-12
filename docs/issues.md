# Ready-to-Paste GitHub Issues

One issue per member for Milestone 1. Create more granular issues per requirement ID as work starts. Copy acceptance criteria from the Excel sheet into each issue.

## Issue 1: Auth, accounts, admin, audit logs (ACC-01..19, GEN-07, GEN-09, GEN-10)
**Owner:** Habashi (do foundations first, by day 2)
- [ ] Shared auth guard, roles guard, `@Roles()`, global validation pipe, global error filter, Swagger setup
- [ ] Register, login (lockout, session expiry, status), logout, change password, me
- [ ] Profile get/update/deactivate
- [ ] Admin: create moderators, list accounts, suspend/reactivate, admin password reset
- [ ] Admin: deactivate/reactivate providers (hidden from search, confirmed bookings stay valid, notify)
- [ ] Admin: bookings, reports review, delete content, audit logs
- [ ] Seed administrator account

## Issue 2: Airlines, flights, flight search (FLT-01..09, FLT-11, FLT-12, FLT-15, FLT-17, FLT-29)
**Owner:** Youssef Wahby
- [ ] Airline profile, baggage and cancellation policies
- [ ] Flights, cabins, schedule changes, cancel flight
- [ ] Moderator limited to own airline
- [ ] Search one-way and round-trip with passengers, cabin, price filter, sorting, pagination, time zones
- [ ] Passenger export and flight bookings view

## Issue 3: Itinerary budgets and exchange rates (ITN-14..18, ITN-26)
**Owner:** Youssef Wahby
- [ ] Budget entries and intercity transport costs
- [ ] `GET /api/itineraries/:id/budget-summary`
- [ ] FXRatesAPI via backend with key in `.env`; handle invalid code, missing rate, API failure
- [ ] `GET /api/itineraries/:id/flights`

## Issue 4: Flight booking, holds, cancellation (FLT-19..26)
**Owner:** Yahia Tarek
- [ ] Hold endpoint, concurrency-safe, expires and releases seats
- [ ] Booking with passengers and baggage, price snapshot, unique reference, states
- [ ] Confirm only after verified payment; e-ticket
- [ ] Cancel per airline policy with refund calculation
- [ ] Parallel-request test proving no overselling

## Issue 5: Payments, refunds, notifications (PAY-01..03, GEN notifications)
**Owner:** Ziad Mohannad (publish service interfaces by day 3)
- [ ] Stripe test mode payments, retry, status, webhook with signature check
- [ ] Policy view and acceptance with timestamp
- [ ] Refund calculation and `RefundService`; `GET /api/refunds/:id`
- [ ] Failed/expired payment releases inventory
- [ ] `NotificationService` + list/read endpoints

## Issue 6: Itinerary structure (ITN-01..12, ITN-20, ITN-21, ITN-25)
**Owner:** Ziad Mohannad
- [ ] Itinerary CRUD, days, activities, images
- [ ] Dates derived from start date and order; renumbering and budget recalculation on add/delete/reorder
- [ ] Public/private, public search, clone with attribution
- [ ] `GET /api/itineraries/:id/hotels`

## Issue 7: Hotels, rooms, availability, hotel search (HTL-01..12, HTL-15, HTL-22)
**Owner:** Amina (publish schemas by day 3)
- [ ] Hotel profile, rooms, availability, blocked dates, policies
- [ ] Moderator limited to own hotel
- [ ] Search by destination, dates, guests with filters, sorting, pagination
- [ ] Available rooms and reservations view

## Issue 8: Hotel booking and reviews (HTL-16..24)
**Owner:** Abdelrahman
- [ ] Booking with no overlapping reservations under concurrency
- [ ] Multi-room booking is atomic
- [ ] Confirm only after verified payment; cancel per hotel policy
- [ ] Reviews only after a completed stay; hotel reviews list
- [ ] Parallel-request test proving no overlaps

## Issue 9: Blog and community (BLG-01..12, GEN-09)
**Owner:** Ahmed Ismail
- [ ] Posts (Draft/Published), author-only edit/delete, search, tags, author page
- [ ] Comments and likes (one like per user per post)
- [ ] User report endpoint for posts/comments

## Issue 10: Seeding, uploads, docs (GEN-08)
**Owner:** Ahmed Ismail (seed script first, by day 2)
- [ ] Seed script for countries, cities, airports (IANA time zones), attractions using official datasets
- [ ] Shared image upload helper with type/size validation
- [ ] Keep README, `AI_PROMPTS.txt` and `docs/api/` current

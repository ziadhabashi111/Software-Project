# Travel Planning and Booking Platform: Specification

Summary spec for planning and review. The official Excel requirements sheet (`docs/requirements/`) is authoritative for exact rules, limits and acceptance criteria. Where this file and the sheet disagree, the sheet wins.

## Problem
Travelers need one place to search and book flights and hotels, plan day-by-day itineraries with budgets, and share travel experiences. Airline and hotel moderators manage their own inventory and policies. Administrators supervise accounts and community content.

## Actors
Guest, Registered User, Administrator (seeded, no self-registration), Airline Moderator (exactly one airline), Hotel Moderator (exactly one hotel), System/automated services.

## Feature areas and requirement prefixes
| Area | Prefix | Owner |
|---|---|---|
| Accounts, auth, admin | ACC, GEN | Habashi |
| Flights, flight search | FLT | Youssef Wahby |
| Flight booking, holds, cancel | FLT | Yahia Tarek |
| Hotels, rooms, availability, search | HTL | Amina |
| Hotel booking, reviews | HTL | Abdelrahman |
| Payments, refunds, notifications | PAY, GEN | Ziad Mohannad |
| Itineraries (structure) | ITN | Ziad Mohannad |
| Itinerary budgets and FX | ITN | Youssef Wahby |
| Blog and community | BLG, GEN | Ahmed Ismail |

## Core entities
User, Moderator Assignment, Airline, Airport, Flight, Cabin Inventory, Airline Policy, Flight Booking, Passenger, Hotel, Room, Room Availability, Hotel Policy, Hotel Booking, Review, Payment, Refund, Itinerary, Itinerary Day, Activity, Budget Entry, Transport Cost, Exchange Rate, Blog Post, Comment, Like, Tag, Report, Notification, Audit Log.
Use embedded documents for bounded parent-owned data and references for shared or independently changing data.

## Key behaviors
- Passwords follow the required rules; failed-login lockout; session expiry; suspended accounts cannot log in.
- Flight holds are concurrency-safe and expire; hotel bookings cannot overlap; multi-room bookings are atomic.
- Bookings become Confirmed only after verified Stripe test-mode payment; failed or expired payments release inventory.
- Provider policies are shown and accepted before payment; acceptance is stored with a timestamp.
- Cancellations and refunds follow the applicable provider policy.
- Itinerary dates derive from the start date and day order; day changes recalculate numbering, dates and budgets.
- Budget totals convert via FXRatesAPI (backend only); handle invalid codes, missing rates, API failures.
- Private itineraries are owner-only; public ones can be searched, viewed and cloned (independent private copy with attribution).
- Blog posts are Draft or Published; one like per user per post; users report content; admins dismiss, hide or delete; moderation actions are audited.
- In-app notifications are mandatory; email notifications are optional.

## API contract
See the endpoint tables in `docs/requirements/Project_Description.pdf` (sections 8.1 to 8.10). Swagger must document every endpoint with its requirement ID.

## Validation and security
- DTO validation on every input; reject unknown properties.
- Role and ownership checks on the backend for every protected route.
- Tokens only in httpOnly cookies; no raw card data; secrets only in `.env`.
- Image uploads validated (type and size).

## MVC / module boundary
- Controller: HTTP concerns. Service: business and database logic. Schema: persistence. DTO: validation.
- The frontend calls the API and never accesses MongoDB directly.

## Out of scope unless done after all mandatory work
Email verification and email recovery, email notifications, flight changes and seat selection, hotel moderator review replies, attaching bookings to itineraries, itinerary PDF export, attaching itineraries to posts, admin analytics and favourites, cloud deployment.

## Data model diagram
See `docs/erd.md`.

## Definition of Done
- Follows this spec, `AGENTS.md` and the Excel requirements.
- Relevant tests and lint pass.
- Swagger reflects API changes.
- Diff is reviewed in full.
- AI usage is logged in `AI_PROMPTS.txt`.
- PR is reviewed by the team leader and merged to `develop`.

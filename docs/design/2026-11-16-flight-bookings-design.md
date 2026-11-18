# Flight bookings module: design and architecture (Yahia Tarek, member 3)

| | |
|---|---|
| **Owner** | Yahia Tarek (member 3) |
| **Folder** | `backend/src/flight-bookings/` |
| **Issues** | 18-22 in `docs/issues.md` |
| **Deadline** | Milestone 1, Fri 20/11/2026. Evaluated through Swagger UI (PDF §7.1, §13.1). |
| **Status** | Draft for Yahia's approval. Revised 18/11 against the latest `develop` (`e4cea9f`). |

## 0. Sources (what wins when they disagree)

1. **Official requirements sheet:** `docs/requirements/SP1_Reviewed_Requirements.xlsx`, mirrored in `REQUIREMENTS.md`. It is authoritative for the rules.
2. **Project description PDF:** `docs/requirements/Project_Description.pdf`. It is authoritative for the endpoint table (§8.4), the domain model (§5), seeding (§5.1) and the milestones (§7, §13).
3. `specs/travel-platform.md`, `AGENTS.md`, `PROJECT_BREAKDOWN.md`: the team's rules and ownership.
4. Code already merged on `develop`: Youssef's `flights/`, Ziad's interfaces, Amina's `hotel-bookings/`, Habashi's hooks.

Requirement IDs are quoted from the sheet. A "PDF §x" reference points to the project description.

## 1. Intent

PDF §6.2: "Registered users enter passenger and baggage details, review the booking summary, accept applicable policies, and proceed to payment. Flight inventory must be protected through concurrency-safe temporary holds… After successful payment verification, the booking becomes confirmed and receives a unique reference and e-ticket. Users can inspect their bookings and cancel eligible reservations according to airline policies."

**The user flow and who serves each step:**

| Step | Endpoint | Owner |
|---|---|---|
| Enter passengers and baggage, see the summary | `POST /api/flight-bookings` | me (FLT-19, FLT-21) |
| Proceed to payment: seats held | `POST /api/flight-bookings/hold` | me (FLT-22) |
| View and accept the airline's policies | `GET` / `POST /api/bookings/flight/:id/(accept-)policies` | Ziad (PAY-02) |
| Pay | `POST /api/payments`, then the webhook | Ziad (PAY-01); he calls my `confirmPaid` |
| Confirmed, reference, notification, e-ticket | `GET /api/flight-bookings/:id/e-ticket` | me (FLT-23) |
| My bookings and details | `GET /api/flight-bookings[/:id]` | me (FLT-25) |
| See the refund, confirm, cancel | `POST /api/flight-bookings/:id/cancel` | me (FLT-26); Ziad issues the refund (PAY-03) |

**What evaluators will probe:**
- two simultaneous holds for the last seat;
- the 10-minute expiry;
- infant, child and adult rules;
- a round trip being one booking, one payment and one reference;
- no confirmation without verified payment;
- the refund shown before cancelling;
- cancellation blocked after departure.

## 2. Situation on `develop` (18/11)

**Youssef (flights): merged.**
- `Flight.cabins[]` holds `totalSeats`, `bookedSeats`, `heldSeats`, `price`, `freeBags` and `maxBagWeightKg`. `everBooked` locks the airports after the first booking.
- `Airline` holds `isActive`, `baggagePolicy { extraBagPrice, maxExtraBags }` and `cancellationPolicy[]`. `Airport` holds `iataCode`, `name`, `cityId` and `timeZone`.
- He defined the `FlightBookingHooks` registry (`FlightBookingLink`) for me to implement.
- **Helpers he exported for reuse:**
  - from `passenger-rules.ts`: `passengerTypeFor`, `assertPassengerMix`, `INFANT_FARE_SHARE`;
  - from `airline-policies.ts`: `refundPercentFor`;
  - from `time-zones.ts`: `utcToLocal`;
  - from `flight-rules.ts`: `seatsRemaining`;
  - from `flight-status.ts`: `effectiveStatus`.

**Ziad (payments, notifications).**
- **Merged:** `BookingStatus` with `assertCanTransition`, and the `NOTIFICATION_SERVICE`, `REFUND_SERVICE` and `PAYMENT_SERVICE` tokens.
- **Not merged:** the implementations. Notifications are in progress on `feature/GEN-01-in-app-notifications`.

**Amina (hotel bookings): merged.**
- `SharedServices`: a lazy `ModuleRef` lookup of Ziad's tokens.
- `HotelReservationPayments`: `forPayment`, `attachPaymentIntent`, `recordPaymentFailure`, `confirmPaid`, `refundQuote`, `refundBasis`, `recordRefundResult`.
- `createTestApp({ replSet: true })`: a test database that supports transactions.

**Habashi:**
- `DeactivationBlockers` (ACC-12) and `BookingSources` (ACC-17);
- `assertCanAccess`, the pagination helper, `ApiReq`, `ParseObjectIdPipe` and the error filter.

**CI** (`.github/workflows`) runs lint, unit tests, build and e2e tests (in-memory replica set) on every PR.

**Review of Youssef's code (18/11):**
- **Correct:** authorization, the time-zone conversion (script-tested over 12 zones) and the seat maths.
- **Blocking the demo:** there is no airport seed yet (Ahmed, issue 44). My e2e tests insert airports directly, so they don't depend on it.
- **Sent to Youssef:**
  - a list of a moderator's own flights;
  - the airport-change time shift;
  - notifications in cancel retries;
  - ACC-15 `affectedUserIds`;
  - edits after departure;
  - real-database tests.

**Constraint:** code only in `flight-bookings/`. No edits to `flights/`, `payments/`, `notifications/`, `users/`, `admin/` or `app.module.ts` (it already imports `FlightBookingsModule`).

## 3. Approaches

**How this module talks to the flights module.**

| | Option | Verdict |
|---|---|---|
| 1 | **Import `FlightsModule`.** Use its exported `Flight`, `Airline` and `Airport` models; register with `FlightBookingHooks` | **Chosen.** He exports `MongooseModule` and the hooks for this. There is no cycle, because `FlightsModule` never imports this module. |
| 2 | My own port plus an adapter in his folder | Dropped. It was only needed before his code existed. |

**Where seat counts live.**

| | Option | Verdict |
|---|---|---|
| A | My own seat table | Dropped. His search, his seat-count edit (`SEATS_BELOW_BOOKED`), his airport lock and FLT-29 all read the cabin counters. |
| B | **Conditional `$inc` on his cabin counters** | **Chosen** (Yahia, 18/11). The schema says "changed only by flight bookings", and his seat-count edit uses the same guard on the same document. |

**How this module reaches Ziad's services.**
- **Chosen:** a lazy `ModuleRef` lookup (Amina's pattern). There is no import cycle, and Ziad doesn't need `@Global()`.
- **Rejected:** `@Optional() @Inject`. It needs Ziad's providers to be visible to this module.

## 4. Goals, non-goals, anti-goals

**Goals:**
- every Milestone 1 flight-booking endpoint in PDF §8.4 working in Swagger, including cancel and refund preview before Ziad's services exist;
- concurrency and expiry proven on a real replica set in CI;
- an API for Ziad that has the same shape as Amina's.

**Non-goals:**
- FLT-27 change-flight and FLT-28 seat selection (optional bonuses, PDF §6.2 and §8.4);
- the M2 frontend;
- Ziad's work: Stripe, the `/api/payments` endpoints and the PAY-02 endpoints;
- Youssef's work: the FLT-29 endpoints and the `Departed` job.

**Anti-goals:**
- overselling;
- a booking confirmed by anything but Ziad's verified webhook;
- one user seeing another's booking;
- editing teammates' folders;
- a second copy of the tier, passenger-type or time-zone rules.

## 5. Requirements traceability

| Req | What the sheet says (short) | Where in code | Proved by |
|---|---|---|---|
| FLT-19 | Full name, DOB, passport/ID per passenger; optional extra bags **and weight**, up to the airline max; fee added to the total | `dto/booking-request.dto.ts`, `rules/baggage-rules.ts`, `rules/pricing.ts` | unit `baggage-rules`, `pricing`; e2e summary |
| FLT-21 | Summary (flight, passengers, baggage, total) before payment | `flight-booking-quotes.service.ts` → `POST /api/flight-bookings` | e2e summary |
| FLT-12 | Round trip = 1 booking, 2 segments, 1 payment, 1 reference, cancelled whole on the outbound tier. Adult 12+, child 2-11, infant <2. Infant pays 10% with no seat. At least 1 adult, infants ≤ adults. Type validated against DOB. | `rules/passenger-rules.ts` (wraps Youssef's), `rules/itinerary-rules.ts`, `rules/pricing.ts` | unit; e2e round trip |
| FLT-22 | Atomic hold only if seats remain; Pending Payment for 10 min; Expired releases seats; never oversell | `flight-booking-holds.service.ts`, `seat-inventory.ts`, `flight-booking-expiry.service.ts` | e2e: 5 parallel holds for 1 seat; round trip all-or-nothing; expiry |
| FLT-23 | After payment: Confirmed, held → booked, unique reference, in-app notification, PDF e-ticket | `flight-booking-payments.ts` (`confirmPaid`), `booking-reference.ts`, `e-ticket/e-ticket.renderer.ts` | e2e confirm (idempotent, late, wrong amount); e-ticket PDF |
| FLT-25 | Upcoming / Past / Cancelled with reference, flight, date, passengers, cabin, status; full details | `my-flight-bookings.service.ts`, `flight-booking-view.ts` | e2e lists and access |
| FLT-26 | Cancel own Confirmed booking before departure, after seeing the tier refund and confirming. Seats return; refund created. Blocked after departure. | `flight-booking-cancellations.service.ts`, `rules/cancellation-rules.ts` | unit refund maths; e2e cancel |
| GEN-06 | Flight times in each airport's local time | `flight-booking-view.ts` via Youssef's `utcToLocal` | unit view; e-ticket text |
| GEN-11 | Only the allowed transitions | every status write calls `assertCanTransition` and is conditional on the current status | unit and e2e |
| PAY-01 | Confirmed only after a verified PaymentIntent; retry until expiry; expiry cancels the intent | `flight-booking-payments.ts` (for Ziad); expiry calls `cancelPendingPayment` | e2e with fake payment service |
| PAY-02 | Policies shown and accepted before payment | `flight-booking-payments.ts` → `policiesFor()` (cancellation and baggage snapshot) for Ziad's endpoints | e2e hook |
| PAY-03 | Refund for every cancellation with a positive amount (tiers; 100% when the provider cancels), status shown on details, user notified | cancellations service + `refundBasis` / `recordRefundResult` | e2e |
| PAY-04 | One platform currency | `PLATFORM_CURRENCY` on every amount | unit |
| FLT-05 / 06 / 29 | Youssef's notifications, flight cancel and bookings list | `flight-booking-link.ts` implements `FlightBookingLink` | e2e through his real endpoints |
| ACC-12 | Deactivation blocked by upcoming Confirmed bookings | `registrations/deactivation-blocker.ts` | e2e `DELETE /api/users/me` |
| ACC-15 | Affected travellers notified when an airline is deactivated | `flight-booking-link.ts` → `getConfirmedUserIdsForAirline` (once Youssef calls it) | e2e hook |
| ACC-17 | Admin list of all bookings | `registrations/booking-source.ts` | e2e `GET /api/admin/bookings` |

## 6. Architecture

**Layering** (AGENTS.md: MVC, controllers handle HTTP only, services hold the logic):
- **Controller:** routing, guards, DTO validation and the Swagger `ApiReq`. Nothing else.
- **Services:** one per use case.
- **`rules/`:** pure functions with no Nest or Mongoose code, unit-tested directly.
- **`seat-inventory.ts`:** the **only** code that touches Youssef's seat counters.
- **`flight-booking-link.ts`, `registrations/`:** the adapters toward other modules.

```
backend/src/flight-bookings/
├── flight-bookings.module.ts            imports FlightsModule, UsersModule, AdminModule; registers hooks
├── flight-bookings.controller.ts        the 6 routes of PDF §8.4 (HTTP only)
├── dto/
│   ├── booking-request.dto.ts           outbound / return / passengers[] (FLT-19, FLT-12)
│   ├── list-flight-bookings.dto.ts      group=upcoming|past|cancelled, page, limit (FLT-25)
│   └── cancel-flight-booking.dto.ts     { confirm?: boolean } (FLT-26)
├── schemas/
│   └── flight-booking.schema.ts         FlightBooking + embedded Segment, Passenger, Payment, Refund
├── rules/                               pure, unit-tested
│   ├── passenger-rules.ts               type vs DOB on the local departure date, 1-9 cap (wraps Youssef's)
│   ├── itinerary-rules.ts               bookable flight, round-trip reverse route and order
│   ├── baggage-rules.ts                 extra bags ≤ airline max, weight ≤ cabin kg, fee per segment
│   ├── pricing.ts                       fares, infant 10%, baggage, totals (cents rounding)
│   ├── cancellation-rules.ts            cancellable?, days before departure, refund % and amount
│   └── status-labels.ts                 'Confirmed' ↔ CONFIRMED for Youssef's rows and Habashi's filter
├── booking-reference.ts                 FB-XXXXXXXX, retried on a duplicate key
├── seat-inventory.ts                    hold / release / confirm / return seats: conditional $inc
├── flight-booking-quotes.service.ts     load flights, validate, price → summary (FLT-19/21)
├── flight-booking-holds.service.ts      transaction: seats + booking (FLT-22)
├── flight-booking-expiry.service.ts     @Interval 30 s expiry, Completed sweep (FLT-22, GEN-11)
├── my-flight-bookings.service.ts        grouped list and details, owner/admin (FLT-25)
├── flight-booking-cancellations.service.ts  user cancel and airline cascade (FLT-26, FLT-06, PAY-03)
├── flight-booking-payments.ts           exported API for Ziad (PAY-01/02/03, FLT-23)
├── flight-booking-view.ts               document → response with local times (GEN-06)
├── flight-booking-link.ts               implements Youssef's FlightBookingLink
├── shared-services.ts                   lazy lookup of Ziad's tokens (copy of Amina's pattern)
├── registrations/
│   ├── deactivation-blocker.ts          ACC-12
│   └── booking-source.ts                ACC-17
└── e-ticket/
    └── e-ticket.renderer.ts             pdfkit (FLT-23, GEN-06)

backend/test/flight-bookings.e2e-spec.ts real FlightsModule + replica set + fake Ziad services
```

**How the modules depend on each other.** The arrows show imports. Nothing imports `FlightBookingsModule` back except Ziad's, later.

```
FlightBookingsModule ──imports──▶ FlightsModule     (Flight/Airline/Airport models, FlightBookingHooks)
                     ──imports──▶ UsersModule       (DeactivationBlockers)
                     ──imports──▶ AdminModule       (BookingSources)
                     ──ModuleRef─▶ Ziad's tokens    (no import: avoids the cycle with PaymentsModule)
PaymentsModule (Ziad, later) ──imports──▶ FlightBookingsModule (FlightBookingPayments)
```

**Exports:** `FlightBookingPayments` (for Ziad). Everything else stays internal.

## 7. Data model

**`FlightBooking`** (collection `flightbookings`). PDF §5: "contain selected flights, passengers, baggage, agreed prices, booking references, payment information, and booking states".

- **Owner and shape:** `user` (ref), `tripType` (`one-way` | `round-trip`).
- **`segments[]`** (1-2; `[0]` is the outbound):
  - `flight` (ref), `airline` (ref), `cabinClass`;
  - **agreed price snapshot:** `farePerSeat`, `freeBags`, `maxBagWeightKg`, `extraBagPrice`.
  - The schedule (times, airports) is **read live** from the flight. FLT-05 lets an airline change times, and a copy would show stale times on the e-ticket.
- **`passengers[]`** (embedded; PDF §5 entity "Passenger"):
  - details: `fullName`, `dateOfBirth`, `documentNumber`, `type`;
  - baggage: `extraBags`, `extraBagWeightKg`;
  - money: `fare` (per segment, summed) and `baggageFee`.
- **Price:** `seats` (adults + children), `price { fares, baggage, total }`, `currency = PLATFORM_CURRENCY`.
- **`cancellationTiers`:** a snapshot of the outbound airline's tiers (FLT-12: "using the outbound segment's tier"). With the baggage policy snapshot, this is what PAY-02 shows.
- **`status`** (`BookingStatus`) and its timestamps: `holdExpiresAt`, `confirmedAt`, `completedAt`, `expiredAt`, `cancelledAt`; plus `cancelledBy` (`user` | `airline`).
- **`reference`:** unique and sparse, set on confirmation.
- **`payment`:** `paymentIntentId`, `amount`, `status`. Only these, per PAY-01.
- **`refund`:** `refundId`, `percent`, `amount`, `currency`, `status` (`PENDING` | `REFUNDED` | `FAILED`, PAY-03).
- **Indexes:**
  - `{ user: 1, status: 1, createdAt: -1 }`;
  - `{ 'segments.flight': 1, status: 1 }`;
  - `{ status: 1, holdExpiresAt: 1 }`;
  - `{ reference: 1 }` unique and sparse.

## 8. Concurrency (FLT-22)

**The hold** is one `connection.transaction()`, which retries transient write conflicts. For each segment, `seat-inventory.hold()` runs:

```
flights.findOneAndUpdate(
  { _id, status: 'Scheduled', departureUtc: { $gt: now },
    $expr: <cabin with cabinClass has totalSeats - bookedSeats - heldSeats >= seats> },
  { $inc: { 'cabins.$[c].heldSeats': seats }, $set: { everBooked: true } },
  { arrayFilters: [{ 'c.cabinClass': cabinClass }], returnDocument: 'after', session })
```

- **No match → 409 `SEATS_UNAVAILABLE`, and the transaction aborts.** On a round trip the outbound increment is rolled back too: both segments or neither.
- The fare snapshot comes from the document the update returned, so it is the price at the moment the seat was held. FLT-05: "price changes do not affect existing bookings".
- The booking is inserted in the same transaction as `PENDING_PAYMENT` with `holdExpiresAt = now + 10 min` (`HOLD_MINUTES = 10`, from FLT-22).

**Two holds for the last seat:** both conditional updates hit the same `Flight` document, and MongoDB serializes them. One commits, the other no longer matches. The result is exactly one 201 and one 409.

**Races with Youssef's writes, all on the same document:**
- **Seat-count edit:** both sides use the same `booked + held ≤ total` guard.
- **Flight cancel:** he sets `Cancelled` first, and holds match only `Scheduled`.
- **Airport edit:** he requires `everBooked: false`, and the hold sets it in the same write.
- **Airline deactivation:** read just before the transaction. A deactivation in that few-millisecond gap is accepted (**my call**). It can't oversell, and ACC-15 keeps existing Confirmed bookings valid anyway.

**Other transitions.** Each is a conditional status update plus the counter change in one transaction:

| Transition | Status change | Counter change |
|---|---|---|
| **Expiry** (`@Interval` 30 s, plus a lazy check on read and on confirm) | `PENDING_PAYMENT` with `holdExpiresAt ≤ now` → `EXPIRED` | `heldSeats -= seats`; after commit, `cancelPendingPayment` (PAY-01) |
| **Confirm** (Ziad's webhook only) | `PENDING_PAYMENT`, not expired, amount and currency match, every flight still `Scheduled` and in the future → `CONFIRMED`. Otherwise `rejected`, and Ziad refunds. | `heldSeats -= seats`, `bookedSeats += seats` in one `$inc` |
| **Cancel** (user or airline) | `CONFIRMED` → `CANCELLED` | `bookedSeats -= seats` on segments not yet departed |
| **Completed** (interval) | `CONFIRMED` whose last segment has departed → `COMPLETED` | none |

**Counter guards:** every decrement has a `>= seats` filter, because `$inc` skips the schema's `min: 0`.

## 9. Endpoints (PDF §8.4, exactly)

**Common rules:**
- Guarded by role `user`; `GET /:id` also allows `admin`.
- Someone else's booking → **404** (`assertCanAccess`).
- Ids go through `ParseObjectIdPipe`. DTOs use class-validator, and unknown fields are rejected.
- Every route carries `ApiReq` with its requirement IDs.

| Method | Route (PDF §8.4) | Req | Behavior |
|---|---|---|---|
| POST | `/api/flight-bookings` | FLT-19, FLT-21 | **Booking summary.** Validates the flights, cabins, passengers and baggage. Returns segments in local time, each passenger with type and price, baggage fees, the total, and the airline policies to be accepted. **Stores nothing and holds nothing.** |
| POST | `/api/flight-bookings/hold` | FLT-22 | Same body and the same validation, then the atomic hold. Returns the booking in `PENDING_PAYMENT` with `holdExpiresAt`. 409 `SEATS_UNAVAILABLE`. |
| GET | `/api/flight-bookings?group=upcoming\|past\|cancelled` | FLT-25 | Own bookings, 10 per page. Rows show reference, flight, date, passengers, cabin and status. **Upcoming:** an unexpired pending hold, or confirmed with the last segment not departed. **Past:** completed and expired (**my call**). **Cancelled:** cancelled. |
| GET | `/api/flight-bookings/:id` | FLT-25, PAY-01, PAY-03 | Full details: payment and refund status, local times, and for a cancellable booking, the `cancellation` preview (days, %, amount). Owner or admin. |
| POST | `/api/flight-bookings/:id/cancel` | FLT-26, PAY-03 | Body `{ confirm?: boolean }`. **Without `confirm: true` it changes nothing** and returns the refund preview with "send confirm: true to cancel" (FLT-26: "after viewing the refund amount… and confirming"). With `confirm: true`, one transaction sets `CANCELLED`, records the refund (`PENDING` when > 0) and returns the seats. Then `REFUND_SERVICE.issue` is called if it exists, and the user is notified. 409 if not confirmed or the outbound has departed. |
| GET | `/api/flight-bookings/:id/e-ticket` | FLT-23, GEN-06 | PDF attachment. Owner; confirmed or completed only. Shows the reference, passengers, each segment in **local** time with its zone, cabin and baggage. |

**Request body (summary and hold):**

```
{ outbound: { flightId, cabinClass },
  return?:  { flightId, cabinClass },
  passengers: [{ fullName, dateOfBirth, documentNumber, type, extraBags?, extraBagWeightKg? }] }
```

Why the preview lives inside cancel and the details view instead of its own route: PDF §8.4 lists no preview route, and evaluators test against that table (**my call**).

## 10. Business rules (`rules/`, pure and unit-tested)

- **Bookable flight (FLT-22, ACC-15):**
  - `effectiveStatus` is `Scheduled`;
  - the departure is in the future;
  - the airline is active;
  - the cabin class exists.
- **Round trip (FLT-12a):**
  - the return route is the reverse of the outbound;
  - the return departs after the outbound arrives;
  - each segment has its own cabin;
  - one booking, one total, one reference.
- **Passenger type (FLT-12b, FLT-19):** Youssef's `passengerTypeFor(dob, date)`, evaluated on the outbound's **local departure date** (**my call**).
  - The declared `type` must match, otherwise a field-level 400.
  - DOB cannot be in the future.
- **Mix (FLT-12b):** Youssef's `assertPassengerMix`, with 1-9 passengers (the cap is **my call**).
- **Baggage (FLT-19, FLT-08):**
  - `extraBags` from 0 to the airline's `maxExtraBags`. No policy means 0.
  - `extraBagWeightKg` is required when bags > 0 and must be ≤ the cabin's `maxBagWeightKg` ("each extra bag has the same maximum weight as the cabin's free baggage allowance").
  - Fee = `extraBags × extraBagPrice`, charged **per segment** (**my call**).
- **Price (FLT-12b, PAY-04):**
  - adults and children pay the cabin fare;
  - infants pay `INFANT_FARE_SHARE` of it, rounded to cents, and take no seat;
  - all amounts are in `PLATFORM_CURRENCY`.
- **Seats per segment** = adults + children.
- **Cancellation (FLT-26, FLT-09, FLT-12a):**
  - allowed while `CONFIRMED` and before the **outbound** departs;
  - days remaining = whole days until outbound departure (floored, **my call**);
  - refund % = `refundPercentFor(snapshot tiers, days)` on the full total.
- **Airline cancels a flight (FLT-06):** 100% refund. Exception: the return leg is cancelled after the outbound flew; then only the return leg's share is refunded (**my call**).
- **GEN-06:** views return `{ utc, localDate, localTime, offset, timeZone }`, the same as Youssef's flight view.

## 11. Hooks and integration API

**Youssef's `FlightBookingLink`** (registered in `onModuleInit`):

| Method | Behavior |
|---|---|
| `getConfirmedPassengerUserIds(flightId)` | Distinct users with a `CONFIRMED` booking that has a segment on the flight. Used by his FLT-05 time-change notices. |
| `cancelBookingsForFlight(flightId)` | **Idempotent.** Each `CONFIRMED` booking → `CANCELLED` (`airline`), refund recorded and issued, seats released, user notified (`FLIGHT_CANCELLED`). Each `PENDING_PAYMENT` → `EXPIRED` with its hold released. **It never throws because of a refund failure.** Returns `{ cancelled, notifiedUserIds }`. |
| `listBookings(flightId, page?)` | `CONFIRMED` and `CANCELLED` bookings, newest first: `{ reference, passengerNames, cabinClass, seats, status: 'Confirmed' \| 'Cancelled' }`. Without `page`, returns all. |
| `getConfirmedUserIdsForAirline(airlineId)` | ACC-15: users with an upcoming `CONFIRMED` booking on that airline. **Waiting on Youssef** to add it to his interface and call it. |

**Contract change requested of Youssef:** add `notifiedUserIds` to the return value, and drop his own pre-read and notification on cancel. Until he does, the extra field is ignored and both sides notify, which at worst sends a duplicate notice.

**For Ziad: `FlightBookingPayments`, exported.** Same names and shapes as Amina's `HotelReservationPayments`:
- `forPayment(bookingId, userId)` → `{ bookingId, userId, amount, currency, holdExpiresAt, description, paymentIntentId }`. 404 if not the user's; 409 if not payable.
- `attachPaymentIntent(bookingId, paymentIntentId)` and `recordPaymentFailure(bookingId)`: PAY-01 retry until expiry.
- `confirmPaid(bookingId, { paymentIntentId, amount, currency })`. Verified webhook only; idempotent and transactional; returns `confirmed` / `already_confirmed` / `rejected` with a reason.
- `policiesFor(bookingId, userId)`: PAY-02 cancellation tiers and baggage policy from the snapshot. Ziad stores the acceptance (PDF §8.7).
- `refundQuote(bookingId)`, `refundBasis(bookingId)` and `recordRefundResult(bookingId, result)`: PAY-03.

**Registered with Habashi:**
- `DeactivationBlockers` (ACC-12): confirmed bookings whose last segment hasn't departed.
- `BookingSources` (`'flight'`, ACC-17): provider = outbound airline, start = outbound departure, end = last arrival, amount = total.

## 12. Testing

**Unit tests (`rules/*.spec.ts`, plus `booking-reference` and `status-labels`):**
- passenger type at the exact 2nd and 12th birthdays on the local departure date;
- the mix and the cap;
- baggage count and weight, and the no-policy case;
- pricing and rounding;
- round-trip route and order;
- days-before-departure and refund maths;
- the reference format;
- the label map.

**E2E (`test/flight-bookings.e2e-spec.ts`):** `createTestApp({ replSet: true })` with the **real** `FlightsModule`. Airports, an airline and flights are inserted through the models. Ziad's tokens come from fake providers in the test module.
- **Concurrency:** 5 parallel holds for 1 seat → exactly one 201, `heldSeats = 1`, and Youssef's search shows 0 left.
- **Round trip:** return cabin full → 409, and the outbound is unchanged.
- **Against Youssef's endpoints:**
  - lowering seats below held → his 409;
  - the airport edit is locked after a hold;
  - flight cancel blocks holds;
  - the flight-cancel cascade (100% refund, holds expired, idempotent);
  - FLT-29 list and CSV rows.
- **Expiry:** releases seats and calls `cancelPendingPayment`.
- **Confirm:** held → booked plus a reference; idempotent; rejected after expiry, on a wrong amount, or on a cancelled flight.
- **Access:** 404 for another user, 403 for a moderator, an admin can read.
- **Cancel:** preview without `confirm`; cancel records the refund and calls `issue`; with no refund service it stays `PENDING`; 409 after departure.
- **Lists:** groups and pagination.
- **Habashi hooks:** deactivation blocked; the admin list includes flights.
- **E-ticket:** a PDF is returned.

## 13. Conflict plan

- **Base:** `develop`. The branch was fast-forwarded to `e4cea9f` on 18/11 and has no commits of its own yet.
- **Files outside my folder:**
  - new `test/flight-bookings.e2e-spec.ts`;
  - `backend/package.json` and `package-lock.json` (`pdfkit`, and `@types/pdfkit` as a dev dependency, approved for Yahia in PROJECT_BREAKDOWN §6);
  - a new "Flight bookings" section in `backend/README.md`;
  - an append to `AI_PROMPTS.txt`;
  - this design doc.
- **Before pushing:** run `git pull origin develop`. Resolve `AI_PROMPTS.txt` conflicts by keeping both sides. For `package-lock.json`, take `develop`'s version, run `npm install` and commit.
- **Commits:** small, per issue: `feat(flight-bookings): ... (FLT-22)`. Lint, unit, build and e2e run locally before the PR, the same steps as CI.

## 14. Left to the builder

File-internal structure, message wording, Swagger examples and notification text. Notification types (`FLIGHT_BOOKING_CONFIRMED`, `FLIGHT_BOOKING_CANCELLED`, `FLIGHT_CANCELLED`, `FLIGHT_REFUND`) can be renamed to match Ziad's final list.

# Flight Bookings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `backend/src/flight-bookings/`, the 6 routes of PDF §8.4 plus the hooks for Youssef, Ziad and Habashi, so Milestone 1 flight booking can be demonstrated in Swagger.

**Architecture:**
- Controller → one service per use case → pure `rules/`.
- Seats are held with conditional `$inc` on Youssef's `Flight.cabins[]` counters, inside a MongoDB transaction.
- Ziad's services are looked up lazily by token. The module registers itself into the existing hook registries.

**Tech Stack:** NestJS 11, Mongoose 9 (MongoDB transactions), class-validator, `@nestjs/schedule` (`@Interval`), pdfkit, Jest + supertest + mongodb-memory-server (replica set).

**Spec:** `docs/design/2026-11-16-flight-bookings-design.md` (approved by Yahia, 18/11). Section numbers below (§) refer to it.

## Global Constraints

- **Folder:** code only in `backend/src/flight-bookings/`. Outside it, only these files:
  - `backend/test/flight-bookings.e2e-spec.ts`
  - `backend/package.json` and `package-lock.json` (pdfkit)
  - `backend/README.md`
  - `AI_PROMPTS.txt`
- **Packages:** `pdfkit` and `@types/pdfkit` (dev) only.
- **Never** read, print or edit `.env`.
- **Routes**, exactly as in PDF §8.4:
  - `POST /api/flight-bookings` (FLT-19, FLT-21)
  - `POST /api/flight-bookings/hold` (FLT-22)
  - `GET /api/flight-bookings` (FLT-25)
  - `GET /api/flight-bookings/:id` (FLT-25)
  - `POST /api/flight-bookings/:id/cancel` (FLT-26)
  - `GET /api/flight-bookings/:id/e-ticket` (FLT-23)
- **Swagger:** every route carries `@ApiReq(ids, summary, description)`, plus `@ApiTags('flight-bookings')` and `@ApiCookieAuth()`.
- **Statuses:** only `BookingStatus` from `common/booking-status/booking-status.ts`. Call `assertCanTransition(from, to)` before every status write, and make the write conditional on the current status.
- **Money:**
  - every amount is in `PLATFORM_CURRENCY` (`payments/platform-currency.ts`);
  - round to cents with `Math.round(n * 100) / 100`.
- **Constants:**
  - `HOLD_MINUTES = 10`;
  - `MAX_PASSENGERS = 9`;
  - expiry sweep every `30_000` ms;
  - reference format `FB-` + 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- **Errors:**
  - 400 field errors use `fieldError(field, message)` from `common/validation/validation-errors.ts`;
  - 409 uses `ConflictException({ statusCode: 409, error: 'Conflict', message, code })`;
  - another user's booking → 404 via `assertCanAccess`.
- **Reuse, never copy**, Youssef's helpers:
  - from `flights/passenger-rules.ts`: `passengerTypeFor`, `assertPassengerMix`, `INFANT_FARE_SHARE`, `PassengerType`;
  - from `flights/airline-policies.ts`: `refundPercentFor`;
  - from `flights/time-zones.ts`: `utcToLocal`;
  - from `flights/flight-status.ts`: `effectiveStatus`, `FlightStatus`, `CabinClass`.
- **Commits:** Conventional Commits with requirement IDs, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Verification per task:**
  - `cd backend && npx jest src/flight-bookings` (unit);
  - `npx jest --config test/jest-e2e.json test/flight-bookings.e2e-spec.ts --runInBand` (e2e);
  - `npm run lint`.

## Review Focus

- **Birthday right at the time-zone boundary.** A passenger whose 2nd birthday is the outbound's local departure date but not yet its UTC date must count as a child. → Task 2 test `classifies on the local departure date, not the UTC date`.
- **Departure passes while payment is pending.** A hold made 5 minutes before departure, then paid after departure → `confirmPaid` returns `rejected` / `FLIGHT_NOT_BOOKABLE` and the held seats are released. → Task 6 test `rejects a payment once the flight has departed`.
- **Return flight that doesn't really return.** Same flight twice, a non-reverse route, or a return leaving before the outbound lands → field 400 on `return.flightId`. → Task 2 tests in `itinerary-rules.spec.ts`.
- **Cancelling on the departure day.** Fewer than 24 h left means days = 0, and the refund uses the `daysBefore: 0` tier, or 0% if there is none. → Task 2 test `0 days before departure uses the 0-day tier or 0%`.
- **Extra bags with no baggage policy.** `extraBags: 1` on an airline without `baggagePolicy` → 400 `passengers.0.extraBags`. → Task 2 test `no baggage policy allows no extra bags`.

---

### Task 1: Module skeleton, schema, reference and status labels

**Files:**
- Modify: `backend/src/flight-bookings/flight-bookings.module.ts`
- Create: `backend/src/flight-bookings/schemas/flight-booking.schema.ts`
- Create: `backend/src/flight-bookings/booking-reference.ts`
- Create: `backend/src/flight-bookings/rules/status-labels.ts`
- Create: `backend/src/flight-bookings/shared-services.ts`
- Test: `backend/src/flight-bookings/booking-reference.spec.ts`
- Test: `backend/src/flight-bookings/rules/status-labels.spec.ts`
- Modify: `backend/package.json`, `backend/package-lock.json`

**Interfaces:**
- **Produces:**
  - `FlightBooking`, `FlightBookingDocument` and the embedded `BookedSegment`, `BookedPassenger`, `BookingPayment`, `BookingRefund`, fields per design §7. Plus `price: { fares; baggage; total; perSegment: number[] }` and `seats: number`.
  - `newFlightBookingReference(): string`.
  - `isDuplicateReference(error: unknown): boolean`.
  - `parseStatus(value: string): BookingStatus | null`, accepting `Confirmed`, `CONFIRMED`, `pending payment` and `Pending-Payment`.
  - `statusLabel(status: BookingStatus): string`, e.g. `CONFIRMED` → `'Confirmed'`, `PENDING_PAYMENT` → `'Pending Payment'`.
  - `SharedServices` with `notify(userId, type, message): Promise<void>` (never throws), `cancelPendingPayment(bookingId): Promise<void>`, and `refunds(): RefundService | undefined`.
  - `FlightBookingsModule` imports `MongooseModule.forFeature([FlightBooking])`, `FlightsModule`, `UsersModule` and `AdminModule`.

- [ ] **Step 1:** Run `cd backend && npm install pdfkit && npm install -D @types/pdfkit`. Expected: both appear in `package.json`, and nothing else is added.
- [ ] **Step 2:** Write failing tests:
  - `newFlightBookingReference` matches `/^FB-[A-HJ-NP-Z2-9]{8}$/`, and 200 calls never contain `0`, `O`, `1` or `I`;
  - `isDuplicateReference({code: 11000, keyPattern: {reference: 1}})` is `true`, and `({code: 11000, keyPattern: {user: 1}})` is `false`;
  - `parseStatus` maps `'Confirmed'` / `'pending payment'` / `'PENDING_PAYMENT'` to the enum, and `'bogus'` to `null`;
  - `statusLabel(BookingStatus.PENDING_PAYMENT) === 'Pending Payment'`.
- [ ] **Step 3:** Run `npx jest src/flight-bookings`. Expected: FAIL (modules not found).
- [ ] **Step 4:** Implement the three files and the schema.
  - Schema indexes:
    - `{user:1,status:1,createdAt:-1}`;
    - `{'segments.flight':1,status:1}`;
    - `{status:1,holdExpiresAt:1}`;
    - `{reference:1}` unique and sparse.
  - `SharedServices` copies Amina's `hotel-bookings/shared-services.ts` pattern (`ModuleRef.get(token, {strict:false})` in try/catch), using `'flight'` as the booking type.
- [ ] **Step 5:** Run the unit tests and `npm run build`. Expected: PASS, and the build compiles.
- [ ] **Step 6:** Commit `feat(flight-bookings): booking schema, reference and status labels (FLT-22, FLT-23, GEN-11)`.

### Task 2: Pure business rules

**Files:**
- Create in `backend/src/flight-bookings/rules/`:
  - `passenger-rules.ts`
  - `itinerary-rules.ts`
  - `baggage-rules.ts`
  - `pricing.ts`
  - `cancellation-rules.ts`
- Test: a `*.spec.ts` next to each.

**Interfaces:**
- **Consumes:** Youssef's `passengerTypeFor`, `assertPassengerMix`, `INFANT_FARE_SHARE`, `PassengerType`, `refundPercentFor`, `effectiveStatus`, `FlightStatus`.
- **Produces:**
  - `classifyPassengers(passengers: { type: PassengerType; dateOfBirth: Date }[], travelLocalDate: string, today: Date): { adults: number; children: number; infants: number }`.
    - Throws `fieldError('passengers.<i>.type', ...)` on a type mismatch.
    - Throws `fieldError('passengers.<i>.dateOfBirth', ...)` for a DOB in the future.
    - Throws `fieldError('passengers', ...)` above `MAX_PASSENGERS`.
    - Then calls `assertPassengerMix`.
  - `assertBookable(flight: { status: FlightStatus; departureUtc: Date; cabins: { cabinClass: string }[] }, airline: { isActive: boolean } | null, cabinClass: string, field: 'outbound' | 'return', now: Date): void`.
    - Not scheduled, departed or inactive airline → `fieldError(\`${field}.flightId\`, ...)`.
    - Missing cabin → `fieldError(\`${field}.cabinClass\`, ...)`.
  - `assertReturnMatches(outbound: { id: string; departureAirport: string; arrivalAirport: string; arrivalUtc: Date }, ret: { id: string; departureAirport: string; arrivalAirport: string; departureUtc: Date }): void`.
  - `assertBaggage(index: number, extraBags: number, weightKg: number | undefined, policy: { extraBagPrice: number; maxExtraBags: number } | undefined, maxBagWeightKg: number): void`.
  - `priceBooking(segments: { farePerSeat: number; extraBagPrice: number }[], passengers: { type: PassengerType; extraBags: number }[]): { passengers: { fare: number; baggageFee: number }[]; fares: number; baggage: number; total: number; perSegment: number[] }`.
  - `roundMoney(n: number): number`.
  - `daysBeforeDeparture(departureUtc: Date, now: Date): number`: `Math.floor((dep - now) / 86_400_000)`, never below 0.
  - `assertUserCancellable(status: BookingStatus, outboundDepartureUtc: Date, now: Date): void`.
    - Not `CONFIRMED` → 409 `NOT_CANCELLABLE`.
    - `departureUtc <= now` → 409 `ALREADY_DEPARTED`.
  - `quoteUserRefund(total: number, tiers: { daysBefore: number; refundPercent: number }[], outboundDepartureUtc: Date, now: Date): { daysBeforeDeparture: number; refundPercent: number; refundAmount: number }`.
  - `airlineRefundAmount(total: number, perSegment: number[], outboundDeparted: boolean): number`: the return share (`perSegment[1]`) if the outbound has departed, else the total.

- [ ] **Step 1: Write failing tests**
  - **passenger-rules:**
    - adult on the 12th birthday;
    - child the day before the 12th;
    - infant the day before the 2nd;
    - `classifies on the local departure date, not the UTC date`: DOB `2025-03-10`, travel local date `2027-03-10` → child;
    - a declared `adult` with an infant's DOB → error field `passengers.0.type`;
    - 10 passengers → field `passengers`;
    - 2 infants + 1 adult → field `infants` (from Youssef's rule).
  - **itinerary-rules:**
    - a Cancelled flight → `outbound.flightId`;
    - departed → `outbound.flightId`;
    - inactive airline → `outbound.flightId`;
    - `First` missing → `outbound.cabinClass`;
    - the same flight id for both legs → `return.flightId`;
    - CAI→DXB then CAI→DXB → `return.flightId`;
    - a return departing before the outbound arrives → `return.flightId`.
  - **baggage-rules:**
    - `no baggage policy allows no extra bags`: `(0, 1, 20, undefined, 23)` throws `passengers.0.extraBags`;
    - 3 bags when the max is 2 → `passengers.0.extraBags`;
    - bags > 0 without a weight → `passengers.0.extraBagWeightKg`;
    - a weight of 24 when the max is 23 → `passengers.0.extraBagWeightKg`;
    - `(0, 0, undefined, undefined, 23)` passes.
  - **pricing:**
    - 2 segments with fares 100 and 80, `extraBagPrice` 30 and 25;
    - passengers: an adult with 1 bag, a child with 0, an infant with 0;
    - expected: adult fare 180 and baggageFee 55, child 180, infant 18;
    - fares 378, baggage 55, total 433;
    - perSegment `[100+100+10+30, 80+80+8+25]` = `[240, 193]`;
    - an infant fare of 33.33 × 0.1 rounds to 3.33.
  - **cancellation-rules:**
    - tiers `[{30,100},{7,50}]`:
      - 40 days → 100% of 500 = 500;
      - 10 days → 50% = 250;
      - 3 days → 0% = 0;
    - `0 days before departure uses the 0-day tier or 0%`: 23 h before, with tiers `[{0,10}]` → 10%; with `[]` → 0%;
    - `assertUserCancellable(CONFIRMED, past, now)` → code `ALREADY_DEPARTED`;
    - `(PENDING_PAYMENT, …)` → `NOT_CANCELLABLE`;
    - `airlineRefundAmount(433, [240,193], true) === 193`; with `false` → 433.
- [ ] **Step 2:** Run `npx jest src/flight-bookings/rules`. Expected: FAIL.
- [ ] **Step 3:** Implement the five files with the signatures above.
  - Pricing: per segment, `fare = type === INFANT ? roundMoney(farePerSeat * INFANT_FARE_SHARE) : farePerSeat` and `bag = extraBags * extraBagPrice`.
  - Each passenger's `fare` and `baggageFee` are summed over the segments.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(flight-bookings): passenger, baggage, pricing and cancellation rules (FLT-12, FLT-19, FLT-26)`.

### Task 3: Booking summary endpoint and view (FLT-19, FLT-21, GEN-06)

**Files:**
- Create: `backend/src/flight-bookings/dto/booking-request.dto.ts`
- Create: `backend/src/flight-bookings/flight-booking-quotes.service.ts`
- Create: `backend/src/flight-bookings/flight-booking-view.ts`
- Create: `backend/src/flight-bookings/flight-bookings.controller.ts`
- Test: `backend/test/flight-bookings.e2e-spec.ts` (created here, extended by later tasks)

**Interfaces:**
- **Consumes:** all of Task 2; Youssef's `Flight`, `Airline` and `Airport` models via `@InjectModel(Flight.name)` and so on.
- **Produces:**
  - `BookingRequestDto { outbound: SegmentChoiceDto; return?: SegmentChoiceDto; passengers: PassengerDto[] }`.
    - `SegmentChoiceDto { flightId: string (IsMongoId); cabinClass: CabinClass (IsEnum) }`.
    - `PassengerDto { fullName: string (1-100, trimmed); dateOfBirth: string (IsDateString, YYYY-MM-DD); documentNumber: string (3-30, /^[A-Za-z0-9-]+$/); type: PassengerType; extraBags?: number (Int ≥ 0, default 0); extraBagWeightKg?: number (> 0) }`.
    - `passengers` has 1-9 items (ArrayMinSize / ArrayMaxSize).
  - `PreparedBooking`: `{ tripType; segments: { flight: FlightDocument; airline: AirlineDocument; cabinClass; farePerSeat; freeBags; maxBagWeightKg; extraBagPrice }[]; passengers: (PassengerDto & { type; fare; baggageFee; extraBags })[]; seats: number; price; cancellationTiers; baggagePolicy }`.
  - `FlightBookingQuotesService.prepare(dto: BookingRequestDto, now?: Date): Promise<PreparedBooking>`.
    - Loads the flights and airlines, then runs `assertBookable`, `assertReturnMatches`, `classifyPassengers` (using the outbound's `departureLocalDate`), `assertBaggage` and `priceBooking`.
    - The fare is from the current cabin price (re-read at hold, Task 4).
  - `FlightBookingQuotesService.quote(dto): Promise<BookingQuoteView>`.
  - `FlightBookingViews` (injectable, uses the Airport model):
    - `segmentView(flight, airline, cabinClass)` returns `{ flightId, flightNumber, airline: {id,name,code}, cabinClass, departure: EndView, arrival: EndView, durationMinutes }`;
    - `EndView = { airport: { iataCode, name, cityId, timeZone }, utc, localDate, localTime, utcOffset }`, the same field names as Youssef's `FlightEndView`.
  - Controller: `POST /flight-bookings` → `quote`, `@Roles(Role.USER)`, `@HttpCode(200)`, `@ApiReq(['FLT-19','FLT-21','FLT-12'], 'Booking summary (no seats held)', ...)`.

- [ ] **Step 1: Write the e2e fixture and the failing tests.**
  - **Fixture**, in `beforeAll`:
    - `createTestApp({ replSet: true, extraModules: [AuditModule, AdminModule, FlightsModule, FlightBookingsModule, FakeSharedServicesModule] })`;
    - insert airports CAI (`Africa/Cairo`) and DXB (`Asia/Dubai`) through the `Airport` model;
    - an active airline with `baggagePolicy {extraBagPrice: 30, maxExtraBags: 2}` and tiers `[{30,100},{7,50}]`;
    - a helper `makeFlight({ from, to, departInDays, seats, price })` that inserts a Scheduled `Flight` with an Economy cabin (`freeBags 1`, `maxBagWeightKg 23`) and `departureLocalDate` from `utcToLocal`;
    - `loggedInAs(role)`, the same as in `hotel-bookings.e2e-spec.ts`;
    - `FakeSharedServicesModule` provides jest mocks for `NOTIFICATION_SERVICE`, `PAYMENT_SERVICE` and `REFUND_SERVICE`.
  - **Tests:**
    - `summary prices a one-way booking`: 1 adult with 1 bag + 1 infant on a 200 fare → 200, statusCode 200;
      - `price.fares === 220`, `price.baggage === 30`, `total === 250`;
      - `segments[0].departure.localTime` equals `utcToLocal(dep,'Africa/Cairo').time`;
      - `currency === 'USD'`;
      - `heldSeats` is still 0 (nothing stored).
    - `summary rejects an unknown cabin`: `cabinClass: 'First'` → 400 with `errors[0].field === 'outbound.cabinClass'`.
    - `summary rejects a passenger type that does not match the DOB` → 400 `passengers.0.type`.
    - `summary is for registered users`: an admin gets 403, no login gets 401.
- [ ] **Step 2:** Run the e2e test. Expected: FAIL (route missing).
- [ ] **Step 3:** Implement the DTO, the service, the view and the controller route; add the providers to the module.
- [ ] **Step 4:** Run the e2e and unit tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(flight-bookings): booking summary with passengers and baggage (FLT-19, FLT-21, FLT-12, GEN-06)`.

### Task 4: Concurrency-safe hold (FLT-22)

**Files:**
- Create: `backend/src/flight-bookings/seat-inventory.ts`
- Create: `backend/src/flight-bookings/flight-booking-holds.service.ts`
- Modify: `flight-bookings.controller.ts` (`POST /flight-bookings/hold`)
- Modify: `flight-booking-view.ts` (`bookingView(doc)`)
- Test: `backend/test/flight-bookings.e2e-spec.ts`

**Interfaces:**
- **Consumes:** `FlightBookingQuotesService.prepare`, `FlightBookingViews`, `newFlightBookingReference` (not used here), the schema.
- **Produces:**
  - `SeatInventory` (injectable, Flight model):
    - `hold(flightId: Types.ObjectId, cabinClass: CabinClass, seats: number, session: ClientSession, now: Date): Promise<FlightDocument | null>`. One conditional `findOneAndUpdate` with the `$expr`/`$filter` guard from design §8, `$inc` heldSeats, `$set everBooked: true`, `arrayFilters [{'c.cabinClass': cabinClass}]`, `returnDocument: 'after'`.
    - `release(flightId, cabinClass, seats, session): Promise<void>`: heldSeats −= seats, guarded by `heldSeats >= seats` in an `$elemMatch`.
    - `confirm(flightId, cabinClass, seats, session): Promise<boolean>`: heldSeats −= seats and bookedSeats += seats in one update.
    - `returnBooked(flightId, cabinClass, seats, session): Promise<void>`: bookedSeats −= seats, guarded.
  - `FlightBookingHoldsService.hold(user: AuthUser, dto: BookingRequestDto): Promise<FlightBookingView>`.
    - `prepare`, then `connection.transaction(session => ...)`: `seats.hold` for each segment (null → throw 409 `SEATS_UNAVAILABLE`, which aborts).
    - The fare snapshot is taken from the returned cabin `price`, re-priced with `priceBooking`.
    - Creates a `PENDING_PAYMENT` booking with `holdExpiresAt = now + HOLD_MINUTES`.
  - `FlightBookingView`: `{ id, reference: string | null, status, statusLabel, tripType, segments: SegmentView[], passengers, seats, price, currency, holdExpiresAt, payment, refund, cancellation?: RefundQuoteView, createdAt }`.

- [ ] **Step 1: Write failing tests**
  - `holds seats and returns Pending Payment`: 201, `status === 'PENDING_PAYMENT'`, `holdExpiresAt` ≈ now + 10 min (±5 s), cabin `heldSeats === 2` for 1 adult + 1 child + 1 infant, `everBooked === true`.
  - `never oversells the last seat`: a flight with 1 seat, 5 parallel `POST /hold` from 5 users → exactly one 201 and four 409 with `code === 'SEATS_UNAVAILABLE'`, `heldSeats === 1`, and `GET /api/flights/search` shows no availability for that flight.
  - `round trip is all or nothing`: return flight with 0 seats left → 409, outbound `heldSeats` unchanged (0), no booking document.
  - `cannot hold on a cancelled flight`: set the status to Cancelled → 400 `outbound.flightId`.
  - `Youssef's seat edit cannot go below held seats`: after holding 2 of 2, `PATCH /api/flights/:id/cabins/:cabinId {seats: 1}` as the airline moderator → 409 `SEATS_BELOW_BOOKED`.
  - `airports are locked after a hold`: `PATCH /api/flights/:id {arrivalAirport: ...}` → 409 `AIRPORTS_LOCKED`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `SeatInventory`, the holds service and the route (`@ApiReq('FLT-22','Hold seats for 10 minutes (Pending Payment)', ...)`, `@ApiConflictResponse`). Call `flightBookings.syncIndexes()` in the test `beforeAll`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(flight-bookings): concurrency-safe 10-minute seat hold (FLT-22, FLT-12)`.

### Task 5: Expiry and completion jobs (FLT-22, GEN-11, PAY-01)

**Files:**
- Create: `backend/src/flight-bookings/flight-booking-expiry.service.ts`
- Test: `backend/test/flight-bookings.e2e-spec.ts`

**Interfaces:**
- **Consumes:** `SeatInventory.release`, `SharedServices.cancelPendingPayment`.
- **Produces:**
  - `FlightBookingExpiryService.expireDue(now?: Date): Promise<number>` (`@Interval(30_000)` wrapper `sweep()` that logs and never throws).
  - `expireOne(bookingId: Types.ObjectId, now?: Date, options?: { force?: boolean }): Promise<boolean>`: in one transaction, a conditional update `{_id, status: PENDING_PAYMENT, holdExpiresAt: {$lte: now}}` (the `holdExpiresAt` condition is dropped when `force` is set; used by the flight cascade) → `EXPIRED` with `expiredAt`, then `release` for each segment. After commit, `cancelPendingPayment`.
  - `completeDue(now?: Date): Promise<number>`: `CONFIRMED` whose last segment's flight `arrivalUtc <= now` → `COMPLETED` with `completedAt`.

- [ ] **Step 1: Write failing tests**
  - `an expired hold releases its seats`: hold, set `holdExpiresAt` to the past in the DB, `expireDue()` → returns 1, status `EXPIRED`, `heldSeats === 0`, `paymentService.cancelPendingPayment` called with `('flight', id)`.
  - `expiry is safe to run twice in parallel`: `Promise.all([expireDue(), expireDue()])` → `heldSeats === 0`, never negative.
  - `a live hold is not expired`: returns 0.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and add to the module providers.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(flight-bookings): expire unpaid holds and complete flown bookings (FLT-22, GEN-11, PAY-01)`.

### Task 6: Payments API for Ziad (PAY-01, PAY-02, PAY-03, FLT-23)

**Files:**
- Create: `backend/src/flight-bookings/flight-booking-payments.ts`
- Modify: `flight-bookings.module.ts` (export `FlightBookingPayments`)
- Test: `backend/test/flight-bookings.e2e-spec.ts`

**Interfaces:**
- **Consumes:** `FlightBookingExpiryService.expireOne`, `SeatInventory.confirm` / `release`, `newFlightBookingReference`, `isDuplicateReference`, `SharedServices`, `quoteUserRefund`.
- **Produces:** `FlightBookingPayments`. Shapes mirror Amina's `HotelReservationPayments`.
  - `forPayment(bookingId: string, userId: string): Promise<PayableFlightBooking>`.
    - Returns `{ bookingId, userId, amount, currency, holdExpiresAt, description, paymentIntentId: string | null }`.
    - 404 if not the user's; 409 `NOT_PAYABLE` if it is not a live hold.
  - `attachPaymentIntent(bookingId: string, paymentIntentId: string): Promise<void>`.
  - `recordPaymentFailure(bookingId: string): Promise<void>`. Sets `payment.status = 'FAILED'`; the hold stays.
  - `confirmPaid(bookingId: string, paid: { paymentIntentId: string; amount: number; currency: string }): Promise<FlightConfirmResult>`.
    - Possible results:
      - `{ outcome: 'confirmed' | 'already_confirmed'; booking: FlightBookingView }`;
      - `{ outcome: 'rejected'; reason: 'NOT_FOUND' | 'NOT_PENDING' | 'HOLD_EXPIRED' | 'AMOUNT_MISMATCH' | 'FLIGHT_NOT_BOOKABLE' }`.
    - One transaction: status `PENDING_PAYMENT` → `CONFIRMED`, `confirmedAt`, a reference (retried up to 3 times on a duplicate), `payment {paymentIntentId, amount, status:'SUCCEEDED'}`, and `SeatInventory.confirm` per segment.
    - `FLIGHT_NOT_BOOKABLE` when a segment's flight is not Scheduled or has departed. The hold is then released (expired).
    - After commit, notify `FLIGHT_BOOKING_CONFIRMED` with the reference, flight numbers and local departure times.
  - `policiesFor(bookingId: string, userId: string): Promise<{ cancellationTiers; baggagePolicy; freeBags: number[]; maxBagWeightKg: number[] }>`.
  - `refundQuote(bookingId: string, now?: Date): Promise<RefundQuoteView | null>`.
  - `refundBasis(bookingId: string): Promise<FlightRefundBasis | null>`. Returns `{ bookingId, userId, paymentIntentId, amount, percentage, currency, status }`.
  - `recordRefundResult(bookingId: string, result: RefundResult): Promise<boolean>`.

- [ ] **Step 1: Write failing tests**
  - `confirmPaid confirms, books the seats and creates a reference`:
    - outcome `confirmed`;
    - status `CONFIRMED`;
    - reference matches `/^FB-/`;
    - `heldSeats 0`, `bookedSeats 2`;
    - `notifications.notify` called with type `FLIGHT_BOOKING_CONFIRMED`.
  - `confirmPaid is idempotent`: a second call → `already_confirmed`, `bookedSeats` still 2.
  - `confirmPaid rejects a late payment`: expired hold → `rejected` / `HOLD_EXPIRED`, seats released.
  - `confirmPaid rejects a wrong amount` → `AMOUNT_MISMATCH`.
  - `rejects a payment once the flight has departed`: set the flight's `departureUtc` to the past → `FLIGHT_NOT_BOOKABLE`, `heldSeats 0`.
  - `forPayment is owner-only`: another user → 404.
  - `policiesFor returns the snapshot tiers and baggage policy`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and export.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(flight-bookings): payment, policy and refund hooks for the payments module (PAY-01, PAY-02, PAY-03, FLT-23)`.

### Task 7: My bookings and details (FLT-25)

**Files:**
- Create: `backend/src/flight-bookings/dto/list-flight-bookings.dto.ts`
- Create: `backend/src/flight-bookings/my-flight-bookings.service.ts`
- Modify: `flight-bookings.controller.ts`
- Test: `backend/test/flight-bookings.e2e-spec.ts`

**Interfaces:**
- **Consumes:** `FlightBookingViews.bookingView`, `FlightBookingExpiryService.expireOne` (lazy expiry), `quoteUserRefund`.
- **Produces:**
  - `ListFlightBookingsDto extends PaginationQueryDto { group?: 'upcoming' | 'past' | 'cancelled' }` (default `upcoming`).
  - `MyFlightBookingsService.list(user, query): Promise<Paginated<FlightBookingView>>`. Groups:
    - **upcoming:** `PENDING_PAYMENT` with `holdExpiresAt > now`, or `CONFIRMED`;
    - **past:** `COMPLETED` or `EXPIRED` (a due `PENDING_PAYMENT` is expired lazily first);
    - **cancelled:** `CANCELLED`;
    - sorted by `createdAt` desc.
  - `MyFlightBookingsService.get(id, user): Promise<FlightBookingView>`.
    - `assertCanAccess(doc.user, user, { allowRoles: [Role.ADMIN] })`.
    - Includes `cancellation` when `CONFIRMED` and the outbound hasn't departed.
  - Routes:
    - `GET /flight-bookings`: `@Roles(Role.USER)`, `ApiReq('FLT-25', ...)`;
    - `GET /flight-bookings/:id`: `@Roles(Role.USER, Role.ADMIN)`, `ParseObjectIdPipe`, `ApiReq(['FLT-25','PAY-01','PAY-03'], ...)`.

- [ ] **Step 1: Write failing tests**
  - `groups bookings`: one hold, one confirmed, one expired, one cancelled (set directly) → `group=upcoming` total 2, `past` 1, `cancelled` 1; page shape `{items,total,page:1,limit:10}`.
  - `details show local times and the refund preview`: `cancellation.refundPercent === 100` for a flight 40 days out.
  - `another user gets 404, an admin can read, an airline moderator gets 403`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(flight-bookings): my bookings grouped and booking details (FLT-25)`.

### Task 8: Cancellation, the flight cascade and Youssef's link (FLT-26, FLT-06, FLT-29, PAY-03)

**Files:**
- Create: `backend/src/flight-bookings/dto/cancel-flight-booking.dto.ts`
- Create: `backend/src/flight-bookings/flight-booking-cancellations.service.ts`
- Create: `backend/src/flight-bookings/flight-booking-link.ts`
- Modify: `flight-bookings.controller.ts`
- Test: `backend/test/flight-bookings.e2e-spec.ts`

**Interfaces:**
- **Consumes:**
  - `assertUserCancellable`, `quoteUserRefund`, `airlineRefundAmount`;
  - `SeatInventory.returnBooked` / `release`;
  - `FlightBookingExpiryService.expireOne`;
  - `SharedServices`;
  - Youssef's `FlightBookingHooks`, `FlightBookingLink`, `FlightBookingRow`.
- **Produces:**
  - `CancelFlightBookingDto { confirm?: boolean }`.
  - `FlightBookingCancellationsService.cancel(id: string, user: AuthUser, confirm: boolean, now?: Date): Promise<{ cancelled: boolean; preview: RefundQuoteView; booking?: FlightBookingView; message: string }>`.
    - `confirm` false → preview only.
    - `confirm` true → one transaction: `CONFIRMED` → `CANCELLED` (`cancelledBy:'user'`), `refund {percent, amount, currency, status: amount > 0 ? 'PENDING' : undefined}`, `returnBooked` per segment not departed.
    - After commit: `refunds()?.issue('flight', id)` in try/catch → `recordRefundResult`; failure leaves `PENDING`. Then notify `FLIGHT_BOOKING_CANCELLED`.
  - `cancelForFlight(flightId: string, now?: Date): Promise<{ cancelled: number; notifiedUserIds: string[] }>`.
    - Expires each pending booking on the flight (`expireOne` with `force: true`, ignoring `holdExpiresAt`).
    - Cancels each `CONFIRMED` booking with `cancelledBy: 'airline'` and amount `airlineRefundAmount(...)`; notifies `FLIGHT_CANCELLED`.
    - Idempotent: a re-run finds no `CONFIRMED` rows.
  - `FlightBookingLinkAdapter implements FlightBookingLink, OnModuleInit`. Registers with `FlightBookingHooks`, and provides:
    - `getConfirmedPassengerUserIds`;
    - `cancelBookingsForFlight` (delegates);
    - `listBookings` (rows with `statusLabel`, this flight's segment cabin);
    - `getConfirmedUserIdsForAirline` (an extra method; harmless until Youssef calls it).
  - Route: `POST /flight-bookings/:id/cancel`, `@Roles(Role.USER)`, `@HttpCode(200)`, `ApiReq(['FLT-26','PAY-03'], ...)`.

- [ ] **Step 1: Write failing tests**
  - `cancel without confirm only previews`: status still `CONFIRMED`, `preview.refundPercent === 100`.
  - `cancel refunds by tier and returns the seats`, 10 days out:
    - `refund.percent === 50`;
    - `bookedSeats` back to 0;
    - `refundService.issue` called with `('flight', id)`;
    - `refund.status === 'REFUNDED'` (from the mock result).
  - `refund stays PENDING when the refund service fails`: the mock rejects → 200, `refund.status === 'PENDING'`.
  - `cancel after departure is blocked` → 409 `ALREADY_DEPARTED`.
  - `an airline cancelling the flight cancels and refunds every booking`: through the real `POST /api/flights/:id/cancel {confirm:true}` as the moderator.
    - The confirmed booking → `CANCELLED`, refund amount = total.
    - A pending hold → `EXPIRED`.
    - Response `cancelledBookings === 1`.
    - Calling the hook again → `{cancelled: 0}`.
  - `the airline bookings list shows my rows`: `GET /api/flights/:id/bookings` → items[0] has `reference`, `passengerNames`, `status: 'Confirmed'`; the CSV export contains the passenger name.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(flight-bookings): cancel with tier refund and airline flight cancellation (FLT-26, FLT-06, FLT-29, PAY-03)`.

### Task 9: E-ticket PDF (FLT-23, GEN-06)

**Files:**
- Create: `backend/src/flight-bookings/e-ticket/e-ticket.renderer.ts`
- Modify: `flight-bookings.controller.ts`
- Test: `backend/src/flight-bookings/e-ticket/e-ticket.renderer.spec.ts`
- Test: `backend/test/flight-bookings.e2e-spec.ts`

**Interfaces:**
- **Consumes:** `MyFlightBookingsService.get`, `FlightBookingView`.
- **Produces:**
  - `renderETicket(view: FlightBookingView): Promise<Buffer>` (pdfkit).
    - Content: the title "E-ticket", the reference, passengers with type and document number, and each segment with flight number, airports, **local** date and time with the UTC offset and zone, cabin, free bags and extra bags.
  - Route `GET /flight-bookings/:id/e-ticket`:
    - `@Roles(Role.USER)`, owner only;
    - `CONFIRMED` or `COMPLETED`, else 409 `TICKET_NOT_AVAILABLE`;
    - streams `application/pdf` with `Content-Disposition: attachment; filename="<reference>.pdf"`;
    - `ApiReq(['FLT-23','GEN-06'], ...)` and `@ApiProduces('application/pdf')`.

- [ ] **Step 1: Write failing tests**
  - unit: the buffer starts with `%PDF`;
  - e2e:
    - confirmed booking → 200, `content-type` `application/pdf`, a body starting with `%PDF`;
    - a pending booking → 409 `TICKET_NOT_AVAILABLE`;
    - another user → 404.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(flight-bookings): downloadable e-ticket PDF in local times (FLT-23, GEN-06)`.

### Task 10: Habashi's registries (ACC-12, ACC-17)

**Files:**
- Create: `backend/src/flight-bookings/registrations/flight-booking-registrations.ts`
- Modify: `flight-bookings.module.ts`
- Test: `backend/test/flight-bookings.e2e-spec.ts`

**Interfaces:**
- **Consumes:** Habashi's `DeactivationBlockers`, `DeactivationBlocker`, `BookingSources`, `BookingSource`, `AdminBookingQuery`, `AdminBookingRecord`; `parseStatus`.
- **Produces:** `FlightBookingRegistrations implements DeactivationBlocker, BookingSource, OnModuleInit`, `type = 'flight'`.
  - `hasUpcomingConfirmedBookings(userId)`: `CONFIRMED` with any segment flight `arrivalUtc > now`. Look up the flight ids first, then run `exists`.
  - `find(query)`: newest first.
    - `status` goes through `parseStatus`; unknown → empty.
    - `from` / `to` filter on the outbound departure.
    - provider = outbound airline `{id, name}`, `startDate` = outbound departureUtc, `endDate` = last arrivalUtc, `amount` = `price.total`.

- [ ] **Step 1: Write failing tests**
  - `a confirmed upcoming flight blocks deactivation`: `DELETE /api/users/me` with the body Habashi's DTO requires → 409.
  - `the admin bookings list includes flights`: `GET /api/admin/bookings?type=flight&status=Confirmed` as admin → an item with `type: 'flight'` and `reference` `/^FB-/`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and register in `onModuleInit`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(flight-bookings): deactivation blocker and admin booking source (ACC-12, ACC-17)`.

### Task 11: Docs, full verification, PR

**Files:**
- Modify: `backend/README.md` (new "Flight bookings" section: flow, routes, hooks for Youssef/Ziad/Habashi, how the hold stays concurrency-safe)
- Modify: `AI_PROMPTS.txt` (append an entry: date 18/11/2026, Yahia Tarek, Claude Code, FLT-12/19/21/22/23/25/26, GEN-06/11, PAY-01..03, ACC-12/17, the prompt and how the output was used)
- Add: `docs/design/2026-11-16-flight-bookings-design.md` and this plan

- [ ] **Step 1:** Write both doc changes.
- [ ] **Step 2:** Run `npm run lint`, `npm test -- --runInBand`, `npm run build` and `npm run test:e2e -- --runInBand`. Expected: all pass with 0 lint errors (the same steps as CI).
- [ ] **Step 3:** Run `git pull origin develop`, resolve any conflicts on this branch (keep both sides of `AI_PROMPTS.txt`), and re-run Step 2.
- [ ] **Step 4:** Read the full diff (`git diff origin/develop...HEAD`).
- [ ] **Step 5:** Commit `docs(flight-bookings): README section, design and AI log (FLT-22)`.
- [ ] **Step 6:** Ask Yahia before pushing and opening the PR to `develop`. The PR body uses the repo template, lists the requirement IDs and the verification output, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

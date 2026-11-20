# Data Model (ERD)

The MongoDB collections as built for Milestone 1, taken from the Mongoose schemas in `backend/src/**/schemas` and `*.schema.ts`. Boxes are collections; embedded documents are listed under "Embedded" below rather than drawn as separate entities.

```mermaid
erDiagram
    USER ||--o{ SESSION : "signs in with"
    USER ||--o{ FLIGHT_BOOKING : makes
    USER ||--o{ HOTEL_RESERVATION : makes
    USER ||--o{ HOTEL_REVIEW : writes
    USER ||--o{ ITINERARY : owns
    USER ||--o{ POST : writes
    USER ||--o{ COMMENT : writes
    USER ||--o{ LIKE : gives
    USER ||--o{ REPORT : files
    USER ||--o{ NOTIFICATION : receives
    USER ||--o{ PAYMENT : pays
    USER ||--o{ REFUND : receives
    USER ||--o{ POLICY_ACCEPTANCE : accepts
    USER ||--o{ UPLOAD : uploads
    USER ||--o{ AUDIT_LOG : "acts in (admin)"

    AIRLINE ||--o{ FLIGHT : operates
    AIRPORT ||--o{ FLIGHT : "departs / arrives"
    FLIGHT ||--o{ FLIGHT_BOOKING : "booked on (segments)"

    HOTEL ||--o{ ROOM : has
    HOTEL ||--o{ HOTEL_RESERVATION : "reserved at"
    ROOM ||--o{ ROOM_NIGHT : "taken on"
    HOTEL_RESERVATION ||--o{ ROOM_NIGHT : holds
    HOTEL_RESERVATION ||--o| HOTEL_REVIEW : "may get"

    FLIGHT_BOOKING ||--o{ PAYMENT : "paid by"
    HOTEL_RESERVATION ||--o{ PAYMENT : "paid by"
    FLIGHT_BOOKING ||--o{ REFUND : "refunded by"
    HOTEL_RESERVATION ||--o{ REFUND : "refunded by"
    FLIGHT_BOOKING ||--o{ POLICY_ACCEPTANCE : "policies accepted"
    HOTEL_RESERVATION ||--o{ POLICY_ACCEPTANCE : "policies accepted"

    ITINERARY ||--o{ BUDGET_ENTRY : has
    ITINERARY ||--o{ TRANSPORT_COST : has
    ITINERARY |o--o{ ITINERARY : "cloned from"

    POST ||--o{ COMMENT : has
    POST ||--o{ LIKE : has

    COUNTRY ||--o{ CITY : contains
    CITY ||--o{ AIRPORT : has
    CITY ||--o{ ATTRACTION : has
```

## Collections

| Collection | Owner module | Notes |
|---|---|---|
| `users` | users / auth | role (user, admin, airline/hotel moderator), `providerId` for moderators, status, lockout counter (ACC-05), preferred currency |
| `sessions` | auth | one per login; refresh-token id, last activity (30-minute idle expiry, ACC-06), revoked flag |
| `airlines` | flights | profile, logo, embedded baggage policy and cancellation tiers (FLT-01, FLT-08, FLT-09) |
| `airports` | flights (seeded) | official reference data with IANA time zone (FLT-02, GEN-06, GEN-12) |
| `flights` | flights | airline, airports, UTC times, status (FLT-30), embedded cabins with seat counters |
| `flightbookings` | flight-bookings | user, embedded segments, passengers, price, copied tiers and baggage terms, payment and refund summary (FLT-12..26) |
| `hotels` | hotels | profile, embedded photos, check-in/out times, cancellation tiers (HTL-01, HTL-02, HTL-09, HTL-10) |
| `rooms` | hotels | hotel, beds, occupancy, price, embedded availability and blocked ranges (HTL-03..06); optimistic concurrency |
| `hotel_reservations` | hotel-bookings | user, hotel, embedded reserved rooms, copied tiers, payment and refund summary (HTL-16..21) |
| `hotel_room_nights` | hotel-bookings | one row per room per night held or booked; unique (room, night) prevents overlaps (HTL-18) |
| `hotel_reviews` | hotel-bookings | one per completed reservation (HTL-23, HTL-24) |
| `payments` | payments | Stripe PaymentIntent id, amount, currency, status per booking (PAY-01); no card data |
| `refunds` | payments | Stripe refund id, percent, amount, status, kind (cancellation or rejected payment) (PAY-03) |
| `policyacceptances` | payments | provider policies accepted before payment, with timestamp (PAY-02) |
| `processedstripeevents` | payments | Stripe webhook events already handled (idempotency) |
| `notifications` | notifications | in-app notifications, read flag (GEN-01) |
| `itineraries` | itineraries | owner, countries, start date, visibility, embedded days and activities (with images), clone attribution (ITN-01..21) |
| `budget_entries`, `transport_costs` | itineraries/budget | amounts in their own currency per day / between cities (ITN-14, ITN-16) |
| `exchange_rates` | itineraries/budget | cached FXRatesAPI rates (ITN-18) |
| `posts`, `comments`, `likes` | blog | posts with embedded images and tags, draft/published, hidden flag; one like per user per post (BLG-01..12) |
| `reports` | blog/reports | content type and id, reason, open/resolved with the admin's resolution (GEN-09, GEN-10) |
| `auditlogs` | audit | admin actions: suspensions, password resets, provider changes, content moderation, report resolution (GEN-07) |
| `uploads` | uploads | stored image files, uploader, item kind, attached flag (GEN-08) |
| `countries`, `cities`, `attractions`, `currencies` | reference-data (seeded) | official reference datasets so IDs match the evaluation (GEN-12) |

## Embedded vs referenced

- **Embedded** (bounded, owned by the parent, read together): flight cabins; booking segments, passengers, price, copied cancellation tiers and baggage terms; reserved rooms; room availability and blocked ranges; itinerary days and activities; post images; hotel photos; airline baggage policy and tiers.
- **Referenced** (shared or changing on their own): users, airlines, airports, flights, hotels, rooms, reservations, payments, refunds, reviews, comments, likes, reports, notifications.
- Prices, baggage terms and cancellation tiers are **copied** onto bookings at hold time, so later provider edits do not change existing bookings (FLT-05, HTL-05).

## Booking lifecycle (GEN-11)

```mermaid
stateDiagram-v2
    [*] --> PendingPayment: hold (10 minutes)
    PendingPayment --> Confirmed: verified Stripe payment (webhook)
    PendingPayment --> Expired: hold ran out / flight cancelled / account deactivated
    Confirmed --> Cancelled: user or provider cancels (refund per policy)
    Confirmed --> Completed: flight landed / check-out passed
```

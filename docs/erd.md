# Data Model (ERD)

Agree on the shared schemas on day 1, then keep this diagram updated. Replace or extend the starter below.

```mermaid
erDiagram
    USER ||--o{ FLIGHT_BOOKING : makes
    USER ||--o{ HOTEL_BOOKING : makes
    USER ||--o{ ITINERARY : owns
    USER ||--o{ BLOG_POST : writes
    USER ||--o{ NOTIFICATION : receives
    AIRLINE ||--o{ FLIGHT : operates
    AIRPORT ||--o{ FLIGHT : departure_arrival
    FLIGHT ||--o{ FLIGHT_BOOKING : booked_in
    HOTEL ||--o{ ROOM : has
    ROOM ||--o{ HOTEL_BOOKING : reserved_in
    HOTEL_BOOKING ||--o| REVIEW : may_have
    FLIGHT_BOOKING ||--o{ PAYMENT : paid_by
    HOTEL_BOOKING ||--o{ PAYMENT : paid_by
    PAYMENT ||--o{ REFUND : may_have
    ITINERARY ||--o{ ITINERARY_DAY : contains
    ITINERARY_DAY ||--o{ ACTIVITY : contains
    ITINERARY_DAY ||--o{ BUDGET_ENTRY : has
    ITINERARY ||--o{ TRANSPORT_COST : has
    BLOG_POST ||--o{ COMMENT : has
    BLOG_POST ||--o{ LIKE : has
```

Notes to decide as a team: embedded vs referenced documents (passengers, cabins, availability), booking state machine (Held, Pending, Confirmed, Cancelled, Expired), and the Report, Audit Log and Moderator Assignment entities.

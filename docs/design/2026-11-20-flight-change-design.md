# FLT-27: Change a confirmed flight booking (design)

Bonus requirement FLT-27 (Yahia, issue 58): a registered user changes a Confirmed flight booking's date or flight on the same route and cabin, pays any fare difference through Stripe or gets a lower fare refunded, subject to seat availability.

## API

`PATCH /api/flight-bookings/:id/change-flight` with body `{ segmentIndex?: 0 | 1, flightId }`.

- Without `?confirm=true`: a preview. Nothing changes. Returns the new segment, `currentSegmentTotal`, `newSegmentTotal`, `difference` and `action` (`pay`, `refund` or `none`).
- With `?confirm=true`:
  - `difference <= 0`: the change is applied at once. A lower fare is refunded to the card.
  - `difference > 0`: the new seats are held for `HOLD_MINUTES` and a `FlightBookingChange` is returned. The user pays it like any booking:
    1. `POST /api/payments` with `{ bookingType: 'flight-change', bookingId: <changeId> }`;
    2. the Stripe webhook applies the change.

## Rules

- Only the owner can change their booking (404 for anyone else), and only while it is Confirmed.
- The changed segment has not departed and is still Scheduled.
- The new flight has the same airline, the same departure and arrival airports, and the same cabin class. It is Scheduled, departs in the future, is not the current flight, and has enough free seats (adults + children).
- A round trip keeps its order: the outbound lands before the return leaves.
- When the outbound changes, each passenger's type is checked again against the new outbound local date (FLT-12b). Baggage limits are checked against the new cabin.
- A booking can have only one change waiting for payment (409 `CHANGE_PENDING`).

## Money

- **Pricing:** the new segment is priced the hold-time way (`priceBooking`) at the fare and baggage terms in force when its seats are held. `difference = newSegmentTotal − price.perSegment[i]`.
- **Payment ledger:** the booking keeps a ledger of every Stripe payment, `payments: [{ paymentIntentId, amount, refunded }]`. The first entry is built from `payment` the first time a booking changes.
- **Allocating refunds:** fare-difference refunds and later cancellation refunds are spread over the ledger, newest payment first, never more than an entry's remaining amount, with one Stripe refund per entry.
- **Unchanged bookings:** a booking with a single payment keeps the existing cancellation refund path exactly as it is.
- **Refund records:** the new `Refund` kinds are `fare_difference` (bookingType `flight-change`, bookingId = the change) and `cancellation_part` (bookingType `flight`). The refund webhooks find them and update the change or the booking.
- **Booking refund status:** when a cancellation is refunded in parts, the booking's status is REFUNDED once every part is refunded, FAILED if any part failed, and PENDING otherwise.

## Seats and consistency

- **Applying a change:** done in one MongoDB transaction. Seats are held on the new flight, then held → booked; the old flight's booked seats are returned; the booking's segment, price, passengers and ledger are replaced; and the change is recorded. The booking update is conditional on the booking still being Confirmed and on the segment's flight still being the old one, so two parallel changes cannot both apply.
- **Unpaid changes:** a change waiting for payment holds seats like a booking hold. A sweep expires it once `HOLD_MINUTES` pass, releases its seats and cancels its PaymentIntent, with the same already-paid guard as holds.
- **When things end first:** cancelling the booking, or the airline cancelling the new flight, ends a pending change first. A payment that arrives late is refunded through the existing rejected-payment path.
- **PAY-02:** the policies accepted for the original booking cover the change. The airline's tiers and baggage rules do not change, because the airline is the same.
- **Seat selection (FLT-28):** the seat assignments for the old segment are released when FLT-28 lands. That is wired separately.

## Notifications

- **`FLIGHT_BOOKING_CHANGED`:** sent once a change is applied, with the new flight and times.
- **Fare-difference refunds:** notified by the refund service.

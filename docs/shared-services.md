# Shared booking status and service interfaces (GEN-11)

Published by Ziad. Real implementations arrive with the payments, refunds and notifications issues; until then, mock these in your tests.

## Booking status

```ts
import {
  BookingStatus,
  assertCanTransition,
} from '../common/booking-status/booking-status';
```

Allowed moves (nothing else):

- PENDING_PAYMENT -> CONFIRMED or EXPIRED
- CONFIRMED -> COMPLETED or CANCELLED
- COMPLETED, EXPIRED and CANCELLED are final

Call `assertCanTransition(current, next)` before changing a status. It throws a 409 Conflict on an illegal move.

## Services

Inject each service by its token:

```ts
constructor(
  @Inject(NOTIFICATION_SERVICE)
  private readonly notifications: NotificationService,
) {}
```

| Token | Method | Use it when |
|---|---|---|
| `NOTIFICATION_SERVICE` | `notify(userId, type, message)` | telling a user about a confirmation, cancellation, refund, etc. |
| `REFUND_SERVICE` | `preview(bookingType, bookingId)` | showing "you would get X back" before a cancellation |
| `REFUND_SERVICE` | `issue(bookingType, bookingId)` | the cancellation is confirmed and money must go back |
| `PAYMENT_SERVICE` | `cancelPendingPayment(bookingType, bookingId)` | a Pending Payment hold has expired |

`bookingType` is `'flight'` or `'hotel'`. All methods are async: use `await`.

## Still to agree with Ziad

The payment webhook will need to call your confirm and expire functions. Tell Ziad the names you want, and say if you need more methods on these interfaces.

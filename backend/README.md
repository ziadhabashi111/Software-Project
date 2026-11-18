# Backend (NestJS 11 + MongoDB Atlas)

Milestone 1 (deadline 20/11/2026), evaluated through Swagger UI.

## Run it

```bash
cd backend
cp ../.env.example .env      # then fill in MONGODB_URI and JWT_SECRET (never commit .env)
npm install
npm run start:dev
```

- API: http://localhost:3000/api (health check: `GET /api/health`)
- Swagger UI: http://localhost:3000/api/docs
- The app refuses to start with a clear message if `MONGODB_URI` or `JWT_SECRET` is missing.

```bash
npm run lint
npm test                # unit tests
npm run test:e2e        # integration tests against a real MongoDB in memory (first run downloads it once)
npm run build
npm run seed:admin      # creates the administrator from ADMIN_EMAIL / ADMIN_PASSWORD (safe to run twice)
```

**Database tests.** `backend/test/helpers/app.ts` boots the real modules against a MongoDB running in memory (no Atlas, no mocks). The script runs Node with `--experimental-vm-modules` because the MongoDB driver needs it under Jest (without it the in-memory server rejects the connection). On Windows the very first run can take a minute while the downloaded MongoDB binary is scanned.

## What the scaffold already gives you

- Global `ValidationPipe` (whitelist, forbid unknown fields, transform) - just use DTOs with `class-validator`
- Global exception filter: every error is `{ statusCode, error, message, path, timestamp }`; Mongo duplicate keys become 409; validation errors also carry `errors: [{ field, messages }]` (GEN-02)
- CORS for the frontend (`FRONTEND_URL`) with credentials, `cookie-parser` for httpOnly cookie auth
- Swagger with cookie auth (`access_token`) configured
- Empty placeholder module for every area below. **Add your code only inside your own folder in `src/`.**

## Shared foundations: how to use them

These are global, so you do **not** import their modules. Details of each requirement are in `PROJECT_BREAKDOWN.md`.

**Authentication and roles (ACC-19).** Every route needs a logged-in user by default (a valid `access_token` cookie).

```ts
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';

@Public()                       // open to guests; a logged-in user is still identified
@Get('search') search(@CurrentUser() user?: AuthUser) {}

@Roles(Role.ADMIN)              // 403 for every other role
@Get('accounts') accounts() {}

@Get('me') me(@CurrentUser() user: AuthUser) {}   // any logged-in user
```

Roles: `USER`, `ADMIN`, `AIRLINE_MODERATOR`, `HOTEL_MODERATOR`. A moderator's provider is `user.providerId`.
Forgetting `@Public()` on a guest endpoint gives `401`.

**Ownership (ACC-11).** After loading a booking, private itinerary, etc.:

```ts
import { assertCanAccess } from '../common/security/ownership';

assertCanAccess(booking.user, user);                                   // 404 for anyone else
assertCanAccess(booking.user, user, { allowRoles: [Role.ADMIN] });     // admins may read
assertCanAccess(booking.user, user, { deny: 'forbidden' });            // 403 instead of 404
```

**Pagination (GEN-05, page size 10).**

```ts
import { PaginationQueryDto, skipFor, toPage } from '../common/pagination/pagination';

@Public() @Get() list(@Query() query: PaginationQueryDto) {
  // find().skip(skipFor(query)).limit(query.limit) ... then:
  return toPage(items, total, query);     // { items, total, page, limit }
}
```

**Swagger with the requirement ID.** `@ApiReq('FLT-22', 'Hold seats')` shows `[FLT-22] Hold seats` (use an array for several IDs).

**Audit log (GEN-07).** Inject `AuditLogService` anywhere an admin action changes accounts, providers or content:

```ts
await this.audit.log({ actorId: admin.id, action: AuditAction.ACCOUNT_SUSPENDED, targetType: 'user', targetId: userId });
```

**Passwords (ACC-01, GEN-13).** Inject `PasswordService` (`hash`, `compare`). Use `PASSWORD_REGEX` and `PASSWORD_RULE_MESSAGE` from `auth/password.service.ts` in DTOs.

**Cookies and tokens.** `TokenService` signs/verifies the tokens and `AuthCookiesService` sets/clears the cookies. Cookie settings come from env (`COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN`), token lifetimes from `JWT_EXPIRES_IN` and `JWT_REFRESH_EXPIRES_IN`.

**Sessions.** Every login creates a server-side session (`auth/sessions`). A session expires after 30 minutes without an authenticated request, is revoked on logout, and `SessionService.revokeAllForUser(id)` must be called when an admin suspends or deactivates an account (the admin module does this). `AuthUser.sessionId` is the current session.

**Scheduler.** `ScheduleModule` is set up once in `AppModule`; use `@Cron()` / `@Interval()` from `@nestjs/schedule` in your own service. Make jobs safe to run twice and also check expiry when reading, so a sleeping server never breaks correctness.

## Authentication API (ACC-01, 04, 05, 06, 08, 19; issue 3)

| Endpoint | Who | What |
|---|---|---|
| `POST /api/auth/register` | guest | name, email, password (8+ chars, letter and digit), `consent: true`. Always creates a regular `user`. `409` with `errors[0].field = "email"` if taken |
| `POST /api/auth/login` | guest | sets the `access_token` and `refresh_token` httpOnly cookies, returns `{ user, mustChangePassword }`. Wrong email or password is always the generic `401 Invalid email or password`. 5 failures lock the account for 15 minutes (`429`). A suspended account gets `403 Your account is suspended` |
| `POST /api/auth/refresh` | cookie | new access and refresh tokens (rotation), `204`. Reusing an old refresh token kills the session |
| `POST /api/auth/logout` | anyone | clears the cookies and revokes the session, `204` |
| `GET /api/auth/me` | logged in | the current user (this is how the frontend learns who is logged in) |
| `PATCH /api/auth/change-password` | logged in | `currentPassword` + `newPassword`; signs out other devices, keeps this one, `204` |

**For the frontend (Milestone 2):** tokens are never in the response body or readable by JavaScript; send requests with `credentials: 'include'`. The access token lives 15 minutes (`JWT_EXPIRES_IN`). On a `401`, call `POST /api/auth/refresh` once and retry; if that also fails, go to login (and return to the page afterwards, ACC-10). A `403` with `code: "PASSWORD_CHANGE_REQUIRED"` means a temporary password: send the user to the change-password page (only `me`, `change-password` and `logout` work until then).

**Accounts:** admins are seeded with `npm run seed:admin` (there is no admin registration, ACC-18); moderators are created by an admin (ACC-13) with a temporary password, created with `mustChangePassword: true`.

## Profile and deactivation (ACC-09, ACC-11, ACC-12; issue 4)

| Endpoint | Who | What |
|---|---|---|
| `GET /api/users/me` | logged in | the profile of the logged-in user (never anyone else's) |
| `PATCH /api/users/me` | logged in | edit `name`, `phone` and `preferredCurrency`; nothing is saved unless every field is valid. Email, role and status cannot be changed (`400`) |
| `DELETE /api/users/me?confirm=true` | regular users only | deactivates the account and signs out every device. `409` with `code: "UPCOMING_BOOKINGS"` while the user has upcoming Confirmed bookings. Admins and moderators get `403` |

**Hooks for the other modules** (these exist so the users module does not depend on them):

- **Booking modules (Yahia, Amina):** import `UsersModule`, inject `DeactivationBlockers` and register in `onModuleInit`. Return `true` when the user has a Confirmed booking that has not happened yet:

  ```ts
  onModuleInit() { this.blockers.register(this); }          // class implements DeactivationBlocker
  hasUpcomingConfirmedBookings(userId: string): Promise<boolean> { /* flight departs / hotel check-in in the future */ }
  ```

- **Reference data (Ahmed):** provide the `CURRENCY_CATALOG` token (`isSupported(code): Promise<boolean>`) from the module that holds the seeded currencies (GEN-12). Until it exists, a preferred currency only has to be a 3-letter code.
- **Content modules (blog, itineraries, reviews):** a deactivated user (`status === 'deactivated'`) must have their posts and public itineraries hidden, and their comments and reviews shown as "Deleted user" (ACC-12). Check `UserStatus` from `users/user-status.ts` when you load an author.
- **Admin module (suspend, deactivate provider):** call `SessionService.revokeAllForUser(id)` when you suspend an account so it is signed out immediately.

## Admin API (ACC-07a, 13, 14, 15, 16, 17; issue 5)

Every route is `ADMIN` only (`401` without a login, `403` for users and moderators). Administrators are never changed through the API (`403`).

| Endpoint | What |
|---|---|
| `GET /api/admin/accounts` | paginated (10), newest first; `search` (name or email, literal text), `role`, `status` |
| `POST /api/admin/moderators` | `name`, `email`, `role` (`airline_moderator` or `hotel_moderator`), `providerId`, `temporaryPassword`. Must change the password at first login. `409` if the email exists |
| `POST /api/admin/users/:id/reset-password` | `temporaryPassword`; signs the account out everywhere, clears a login lock, next login must set a new password. `204` |
| `PATCH /api/admin/accounts/:id/suspend` / `reactivate` | users and moderators; suspended accounts are signed out at once and get `403 Your account is suspended` on login. `409` if the account is in the wrong state (a self-deactivated account stays deactivated) |
| `PATCH /api/admin/providers/:type/:id/deactivate` / `reactivate` | `type` is `hotel` or `airline`; returns `{ id, type, name, active, changed }`; nothing is audited or notified when `changed` is false |
| `GET /api/admin/bookings` | read-only, newest first; filters `type` (`flight`/`hotel`), `status`, `from`/`to` (on the departure or check-in date; `YYYY-MM-DD` covers the whole day, UTC) |

Every change writes an audit log entry (never containing a password).

**Hooks for the other modules.** Import `AdminModule` and register in `onModuleInit`:

- **Airlines (Youssef) and hotels (Abdelrahman):** inject `ProviderDirectory` and `register(ProviderType.AIRLINE | ProviderType.HOTEL, handler)`. The handler has `exists(id)` and `setActive(id, active)`. `setActive` returns `{ name, changed, affectedUserIds? }`, or `null` for an unknown id. Deactivated providers must be hidden from search and rejected by booking, existing Confirmed bookings stay valid. Until a type is registered, creating a moderator or (de)activating a provider of that type answers `503` with `code: "PROVIDER_MODULE_UNAVAILABLE"`.
- **Flight and hotel bookings (Yahia, Amina):** inject `BookingSources` and `register({ type: 'flight' | 'hotel', find })`. `find({ status?, from?, to?, skip, limit })` returns `{ items, total }` newest first (`createdAt` descending); rows are `AdminBookingRecord` (see `admin/booking-sources.ts`). Until one is registered the list is simply empty.
- **Notifications (Ziad):** provide the `ADMIN_NOTIFIER` token (`notify(userIds, { type, message })`, an adapter around `NotificationService`). The admin module tells the provider's moderators and `affectedUserIds` when a provider is deactivated or reactivated. If the token is missing nothing is sent.

## Moderation and audit logs (GEN-07, GEN-09 admin side, GEN-10; issue 6)

All routes are `ADMIN` only.

| Endpoint | What |
|---|---|
| `GET /api/admin/audit-logs` | paginated (10), newest first, with the acting admin; filters `action`, `actorId`, `targetType`, `from`/`to` (`YYYY-MM-DD` covers the whole day, UTC) |
| `GET /api/admin/reports` | open reports, newest first, with the reporter. Empty until the report module is connected |
| `PATCH /api/admin/reports/:id` | body `{ action: "dismiss" \| "hide" \| "delete" }`. `409` if already resolved |
| `DELETE /api/admin/content/:type/:id?mode=hide\|delete` | `type` is `post`, `comment`, `review` or `itinerary`; `hide` is the default |

Resolving a report and moderating content are audited (`REPORT_RESOLVED`, `CONTENT_HIDDEN`, `CONTENT_DELETED`). Until a module registers, resolving with `hide` or `delete` answers `503` with `code: "CONTENT_MODULE_UNAVAILABLE"` (the report stays open), and `PATCH /reports/:id` answers `503` with `code: "REPORTS_MODULE_UNAVAILABLE"`.

**Hooks for the other modules** (import `AdminModule`, register in `onModuleInit`):

- **Reports (Ahmed, GEN-09):** inject `ReportDirectory` and `register(source)`. `ReportSource` has `list({ skip, limit })` (open reports, newest first), `findById(id)` and `resolve(id, { action, adminId })`, which must be atomic and return `false` if the report was already resolved. A report's `status` is `open` or `resolved`. See `admin/report-source.ts`.
- **Posts and comments (Ahmed), reviews (Amina), itineraries (Habashi):** inject `ContentModerators` and `register(ContentType.POST | COMMENT | REVIEW | ITINERARY, handler)`. The handler has `hide(id)` and `delete(id)`, each returning `{ authorId?, title? }` or `null` for an unknown id, and both must be safe to call twice. `hide` sets `isHidden`.
- **Showing hidden content:** use `canViewContent(content, user)` or `assertContentVisible(content, user)` from `common/security/content-visibility.ts` wherever you read or list content. Hidden content is visible only to its author and to admins (everyone else gets a `404`).

## Itineraries (ITN-01, 03, 05, 07, 08, 09, 10, 20; issue 7)

Regular users only (`403` for admins and moderators). An itinerary belongs to its owner: anyone else gets `404` (ACC-11).

| Endpoint | What |
|---|---|
| `POST /api/itineraries` | `title` (<= 100), `countries` (codes like `EG`), `startDate` (`YYYY-MM-DD`). Always created private |
| `GET /api/itineraries` | mine, most recently updated first, 10 per page: title, countries, start date, `dayCount`, visibility |
| `GET /api/itineraries/:id` | the full itinerary: numbered, dated `days` (with activities) and `groups` |
| `PATCH /api/itineraries/:id` | title, countries, start date (all day dates follow it), `visibility` (`public`/`private`) |
| `DELETE /api/itineraries/:id?confirm=true` | `204`; copies other users made earlier are not affected |
| `POST /api/itineraries/:id/days` | `city` (required, from the city list), `notes`. Added at the end, at most 60 (`409`, `code: "MAX_DAYS_REACHED"`) |
| `PATCH /api/itineraries/:id/days/:dayId` | `city`, `notes` (`null` clears) |
| `DELETE /api/itineraries/:id/days/:dayId?confirm=true` | the rest are renumbered and re-dated; returns the itinerary |
| `PATCH /api/itineraries/:id/days/reorder` | `{ dayId, position }` moves one day (1 to the number of days) |
| `POST /api/itineraries/:id/days/:dayId/activities` | `name`, optional `description`, `time` (`HH:mm`), `cost`, `currency` |
| `PATCH` / `DELETE /api/activities/:id` | edit (`null` clears optional fields) or delete an activity |

A day has no stored number or date: both follow from its position and the start date, so deleting or moving a day can never leave them wrong. `groups` lists consecutive days in the same city with `startDay`, `endDay`, `dayCount`, dates and a `subtotal`. Days and activities are embedded in the itinerary, saved with optimistic concurrency, so parallel requests never push an itinerary past 60 days or lose a day.

Admins can hide or delete any itinerary through `DELETE /api/admin/content/itinerary/:id` (GEN-10). A hidden itinerary (`isHidden: true`) stays visible to its owner and admins. The public search and the public view (issue 8) must leave out hidden itineraries and those of deactivated owners, and may use `canViewContent`.

**Hooks for the other modules** (import `ItinerariesModule` and register in `onModuleInit`):

- **Countries and cities (Ahmed, GEN-12):** inject `PlaceCatalog` and `register({ isCountry(code), isCity(id) })`. Until then a country only has to look like `EG` and a city like `cairo`.
- **Budgets (Youssef, ITN-14, 16, 18):** inject `ItineraryBudgets` and `register(provider)`. `dayTotals(itineraryId, ownerId)` returns `{ currency, byDay }` in the owner's preferred currency (keyed by day id; the day ids are stable when days move), which gives each group its `subtotal` (`null` until you register, or if it fails). `removeDay` and `removeItinerary` are called after a delete so you can remove the budget entries and transport costs. An activity `cost` is stored with its own optional `currency`; count it under Activities and convert it with your rates.
- **Activity images (ITN-12):** `images` is in the schema; the upload and delete endpoints follow once Ahmed's shared upload helper (GEN-08) exists.

## Platform currency (PAY-04; issue 29)

All flight and hotel prices, payments and refunds use one currency: `PLATFORM_CURRENCY` (`'USD'`, a Stripe-supported currency) from `payments/platform-currency.ts`. It is a constant, not an environment variable, so it cannot differ between environments. Import it wherever you store or charge a price; never hard-code a currency code.

Booking prices are **never converted**. Only itinerary budgets are converted, into the user's preferred currency, by the exchange-rate module (ITN-18). That module must not touch flight or hotel prices.

## Flight bookings (FLT-12, 19, 21, 22, 23, 25, 26, GEN-06, GEN-11; issues 18-22)

Design: `docs/design/2026-11-16-flight-bookings-design.md`. Routes as in PDF section 8.4, all for registered users (`GET /:id` also for admins; another user's booking answers 404):

| Route | Req | What it does |
|---|---|---|
| `POST /api/flight-bookings` | FLT-19, 21, 12 | Booking summary: passengers (type checked against the date of birth on the local departure date), extra bags and weight, prices (infants 10%, no seat), total, policies. Stores nothing. |
| `POST /api/flight-bookings/hold` | FLT-22 | Same body; holds the seats for 10 minutes as one Pending Payment booking (a round trip is all or nothing, 409 `SEATS_UNAVAILABLE`). |
| `GET /api/flight-bookings?group=upcoming\|past\|cancelled` | FLT-25 | My bookings, 10 per page. |
| `GET /api/flight-bookings/:id` | FLT-25, PAY-01, PAY-03 | Details in local times, payment and refund status, and `cancellation` (the refund if cancelled now). |
| `POST /api/flight-bookings/:id/cancel` | FLT-26, PAY-03 | Without `{ "confirm": true }` only shows the refund; with it, cancels, returns the seats and creates the refund. Blocked after departure. |
| `GET /api/flight-bookings/:id/e-ticket` | FLT-23, GEN-06 | PDF e-ticket of a Confirmed booking. |

**Seats are concurrency-safe:** every hold, confirmation, expiry and cancellation is one conditional `$inc` on the flight's cabin counters (`heldSeats`, `bookedSeats`) inside a MongoDB transaction, guarded by `total - booked - held >= seats`. Two requests for the last seat: one wins, the other gets 409. A job every 30 s (plus a check on read) expires unpaid holds and releases their seats; Confirmed bookings become Completed once their last flight lands.

**For the payments module (Ziad):** import `FlightBookingsModule` and use the exported `FlightBookingPayments`. Same names as the hotel side:
- `forPayment(bookingId, userId)` and `attachPaymentIntent` / `recordPaymentFailure` (PAY-01, retry until the hold expires)
- `confirmPaid(bookingId, { paymentIntentId, amount, currency })` from the verified webhook only. Idempotent. Returns `rejected` with a reason (`HOLD_EXPIRED`, `AMOUNT_MISMATCH`, `FLIGHT_NOT_BOOKABLE`, ...) when the payment must be refunded.
- `policiesFor(bookingId, userId)` for PAY-02 (cancellation tiers and baggage policy accepted at hold time)
- `refundQuote`, `refundBasis` and `recordRefundResult` for `RefundService` (PAY-03)

This module finds `NOTIFICATION_SERVICE`, `PAYMENT_SERVICE` and `REFUND_SERVICE` by token at runtime, so there is no import cycle. Until they exist, notifications are skipped and refunds stay Pending.

**For the flights module (Youssef):** registered with `FlightBookingHooks`: `getConfirmedPassengerUserIds` (FLT-05), `cancelBookingsForFlight` (FLT-06; also returns `notifiedUserIds` because each user is notified as their booking is cancelled), `listBookings` (FLT-29) and `getConfirmedUserIdsForAirline` (ACC-15, for `setActive`).

**For the account and admin modules (Habashi):** registered with `DeactivationBlockers` (ACC-12) and `BookingSources` (ACC-17; the status filter accepts `Confirmed` or `CONFIRMED`).

**Running the e2e tests on Node 24:** MongoDB driver 7.8 uses a dynamic `import()` that Jest blocks on Node 24, which shows up as `Missing required sub-document 'driver'`. Run `NODE_OPTIONS=--experimental-vm-modules npm run test:e2e`. CI (Node 22) does not need it.

## Module ownership

| Module | Owner |
|---|---|
| auth, users, admin, audit | Habashi |
| airlines, flights (+ flight search), itinerary budgets / exchange rates | Youssef Wahby |
| flight-bookings (holds, e-ticket, cancel) | Yahia Tarek |
| payments, refunds, notifications | Ziad Mohannad |
| hotel-bookings, reviews | Amina |
| hotels, rooms, availability (+ hotel search) | Abdelrahman |
| blog (posts, comments, likes, tags), uploads, seed script | Ahmed Ismail |
| itineraries (structure) | Habashi |

## Rules

- One folder per feature module: `module`, `controller`, `service`, `schemas`, `dto`
- Validate with DTOs + `class-validator`; protect routes with guards and ownership checks
- Document with Swagger decorators (`@ApiTags`, `@ApiOperation`, ...); reference requirement IDs
- Write at least one test for your service logic; CI runs lint + tests on every PR

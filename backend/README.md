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
| `POST /api/auth/forgot-password` | guest | **ACC-07 (optional).** `email`. Emails a reset link when the address belongs to an active account; the answer is always the same, so it never reveals whether the address is registered. The link works once, for 30 minutes, and a newer request replaces an older link. 10 requests per minute per address |
| `POST /api/auth/reset-password` | guest | **ACC-07 (optional).** `token` (from the email) + `newPassword` (password rules). Single-use and expires after 30 minutes (`400` field `token` otherwise). Signs the account out everywhere, clears a login lock and a forced password change. 10 requests per minute per address |
| `GET /api/auth/verify-email?token=` | guest | **ACC-02 (optional).** Opens the link from the verification email (sent at registration, valid 24 hours, works once; `400` on field `token` otherwise). Marks the account verified. Users created before this, seeded, or made by an admin count as verified. 20 requests per minute per address |
| `POST /api/auth/resend-verification` | logged in | **ACC-02 (optional).** Emails a new verification link, replacing the older one; sends nothing if already verified. 5 requests per minute per address |

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

## Itineraries (ITN-01, 03, 05, 07, 08, 09, 10, 20, 21, 25; issues 7 and 8)

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
| `PATCH` / `DELETE /api/activities/:id` | edit (`null` clears optional fields) or delete an activity (its image files are deleted too) |
| `POST /api/activities/:id/images` | **ITN-12.** Multipart field `images`: JPG or PNG (the real format is checked), <= 5 MB each, at most 5 per activity in total; all or nothing. Returns the activity |
| `DELETE /api/activities/:id/images/:imageId` | removes the image and deletes its file; returns the activity |
| `GET /api/itineraries/public/search` | **open to everyone (ITN-21).** Only public itineraries; `q` (title, or the name/code of a country or city), `country`, `city`, `minDays`, `maxDays`, newest first, 10 per page |
| `GET /api/itineraries/public/:id` | **open to everyone (ITN-21).** Read-only: author, days, activities, groups and the `budget` in `?currency=` (USD by default). `404` for private, hidden or deactivated-author itineraries |
| `POST /api/itineraries/:id/clone` | copy a public itinerary (or your own) into a **new private one of yours** (ITN-21): days, activities and budget entries; credits the original author in `clonedFrom`; independent of the original; activity images are not copied |
| `GET /api/itineraries/:id/hotels` | hotels for a city group of **my** itinerary (ITN-25): `group` (from 1), `guests`, `rooms`; check-in = first day of the group, check-out = the day after its last. Uses the hotel search (HTL-11), so the same rules apply (a stay is at most 30 nights) |
| `POST /api/itineraries/:id/bookings` | **optional bonus (ITN-27).** Link one of **my** Confirmed (or Completed) bookings to a day: `{ bookingType: "flight" | "hotel", bookingId, dayId }`. A flight counts as intercity transport and a hotel stay as accommodation in my budget summary on that day, in the booking's currency. `404` for a booking that is not mine, `409` if it is not confirmed or already linked |
| `GET /api/itineraries/:id/bookings` | **optional bonus (ITN-27).** The linked bookings by day with reference, status, dates and price right now; `counted: false` once a booking is cancelled or expired (it no longer feeds the budget) |
| `DELETE /api/itineraries/:id/bookings/:linkId` | **optional bonus (ITN-27).** Unlink (`204`); the booking itself is untouched. Linked bookings never appear on a public itinerary, its budget or a clone |
| `GET /api/itineraries/:id/pdf` | **optional bonus (ITN-28).** PDF download (`?currency=`). The owner gets days, activities, linked bookings and their budget; anyone else, signed in or not, gets only the public copy of a public, visible itinerary (author, days, public budget, no bookings); everything else is `404` |

A day has no stored number or date: both follow from its position and the start date, so deleting or moving a day can never leave them wrong. `groups` lists consecutive days in the same city with `startDay`, `endDay`, `dayCount`, dates and a `subtotal`. Days and activities are embedded in the itinerary, saved with optimistic concurrency, so parallel requests never push an itinerary past 60 days or lose a day.

Admins can hide or delete any itinerary through `DELETE /api/admin/content/itinerary/:id` (GEN-10). A hidden itinerary (`isHidden: true`) stays visible to its owner and admins. The public search, the public view and the clone leave out hidden itineraries and those of deactivated owners (the owner is checked in the database query, not after the page is cut, so paging stays correct).

**Hooks for the other modules** (import `ItinerariesModule` and register in `onModuleInit`):

- **Countries and cities (Ahmed, GEN-12):** inject `PlaceCatalog` and `register({ isCountry(code), isCity(id), matchKeyword? })`. `matchKeyword(keyword)` returns the `countryCodes` and `cityIds` whose code, id or name contains the keyword, so the public search finds "egypt" or "cairo" (already done by `ReferenceDataService`). Until then a country only has to look like `EG` and a city like `cairo`.
- **Hotel search (Noureldin, HTL-11, ITN-25):** inject `HotelSearchHook` and `register(port)` with `search({ city, checkIn, checkOut, guests, rooms, page, limit })` returning `Paginated<hotel>`. `GET /api/itineraries/:id/hotels` calls it for the dates of the chosen city group, so you do not build anything itinerary-specific; until you register it answers `503`.
- **Blog author page (Ahmed, BLG-12):** the itinerary module registers itself with the blog's `AuthorItineraries`, so an author's public itineraries need nothing from you.
- **Link an itinerary to a post (BLG-13, optional bonus):** `PATCH /api/posts/:id/itinerary` with `{ itineraryId }` (or `null` to unlink) links one of the author's own **public** itineraries to their post. The itinerary module answers the blog's `AuthorItineraries.ownedBy` (the author's own itinerary, public or not) and `publicSummary` (only while it is public, not hidden and its owner active). Readers of `GET /api/posts/:id` get `itinerary` (a summary) only while that holds; the author's own post views show it with `isPublic`. A private, hidden or deleted itinerary simply shows no link.
- **Budgets (Youssef, ITN-14, 16, 18):** inject `ItineraryBudgets` and `register(provider)`. `dayTotals(itineraryId, ownerId)` returns `{ currency, byDay }` in the owner's preferred currency (keyed by day id; the day ids are stable when days move), which gives each group its `subtotal` (`null` until you register, or if it fails). `removeDay` and `removeItinerary` are called after a delete so you can remove the budget entries and transport costs. Optional `cloneBudgets(from, to, dayIdMap)` copies the budget onto a clone (ITN-21) and `publicSummary(itineraryId, currency?)` gives the budget of a public itinerary (both done by `BudgetProvider`). An activity `cost` is stored with its own optional `currency`; count it under Activities and convert it with your rates.
- **Activity images (ITN-12):** done with Ahmed's upload helper (GEN-08). The files belong to the traveller who uploaded them, so only the itinerary's owner can add or remove them, and deleting an activity, a day or the whole itinerary (also by an admin) deletes the files. A clone does not copy images: the files belong to the original author.

## Hotels, rooms and availability (HTL-01 to HTL-10; issues 31 to 33)

Done in `src/hotels/`. A hotel has a profile, rooms, and per-room availability and blocked ranges (embedded in the room, both ends included, saved with optimistic concurrency so parallel requests never leave overlapping ranges).

| Endpoint | Notes |
| --- | --- |
| `POST /api/hotels` | **admin only (HTL-01).** `name`, `address`, `city` (id from the cities list), `country` (code), `description`, `starClass` (1 to 5), `amenities`. Create its moderator afterwards with `POST /api/admin/moderators` |
| `GET /api/hotels/:id` | **open to everyone (HTL-02, 09, 10).** Profile, photos, amenities, check-in/out times (default 14:00 / 12:00), `cancellationPolicy` (longest notice first) and `rating`. A deactivated hotel answers `404` except to admins and its own moderator |
| `PATCH /api/hotels/:id` | the hotel's own moderator only (`403` for any other moderator and for admins) |
| `PUT /api/hotels/:id/policies` | check-in/out times and/or the whole list of cancellation tiers (HTL-09, 10); same tier rule as flights |
| `POST /api/hotels/:id/images` | **HTL-01, GEN-08.** The hotel's own moderator only. Multipart field `images`: JPG or PNG (the real format is checked), <= 5 MB each, at most 5 photos per hotel in total (checked inside the database write, so parallel uploads cannot exceed it); all or nothing. Returns the hotel |
| `DELETE /api/hotels/:id/images/:imageId` | removes the photo and deletes its file; returns the hotel |
| `POST` / `GET /api/hotels/:id/rooms` | **HTL-03.** Room `name` is unique within the hotel (`409`), `beds`, `maxOccupancy`, `pricePerNight`, optional `type` |
| `PATCH` / `DELETE /api/hotels/:id/rooms/:roomId` | edit (the name cannot change), or delete a room nobody ever reserved (`409 ROOM_HAS_RESERVATIONS`) |
| `PATCH /api/hotels/:id/rooms/:roomId/deactivate` / `reactivate` | deactivating is refused while a room has an upcoming reservation (`409 ROOM_RESERVED`) |
| `POST /api/hotels/:id/rooms/:roomId/availability` | **HTL-04.** `{ from, to }`, both days included; ranges of one room may not overlap (`400`) and dates must exist (no 30 February) |
| `PATCH` / `DELETE .../availability/:rangeId` | move or remove a range; refused (`409 AVAILABILITY_IN_USE`) if it would remove a night a reservation holds |
| `POST .../blocks`, `DELETE .../blocks/:blockId` | **HTL-05.** Block nights (maintenance); refused (`409 ROOM_RESERVED`) over a held night |
| `GET /api/hotels/:id/availability?from&to` | **HTL-08.** Every room, every night: `Available`, `Booked` (with `reservationId` and the booking `reference`, `null` until paid) or `Blocked`. At most 62 days |
| `GET /api/hotels/search` | **open to everyone (HTL-11, 12).** `city` or `country`, `checkIn`, `checkOut`, `guests`, `rooms` (default 1). Active hotels with at least that many rooms free for the whole stay and combined maximum occupancy >= guests. Filters: inclusive `minPrice` / `maxPrice` per night (of the cheapest free room), `minRating` 1-5 (unrated hotels are left out when set). Sort: `sortBy=price|rating`, `order=asc|desc` (unrated last). Paginated (10 per page). `400`: no place, check-out not after check-in, check-in in the past, impossible date, rooms > guests, min price > max, stay over 30 nights |
| `GET /api/hotels/:id/rooms/available?checkIn&checkOut` | **open to everyone (HTL-15).** Free rooms, cheapest first, with type, beds, maximum occupancy, `pricePerNight` and `totalPrice` (x nights). A deactivated hotel is `404` except to admins and its own moderator |
| `GET /api/hotels/:id/reservations` | **HTL-22.** The hotel's own moderator (or an admin): guest, dates, status, reference, rooms, total; paginated |

A room is **free** for a stay (search and free rooms) when it can be booked and no Confirmed reservation or unexpired hold has taken any night. A room can be booked for a stay only if the room and hotel are active, every night lies inside an availability range and no night is blocked (check-out day excluded). `HotelCatalog` is what the booking module and the admin see: it registers with `HotelInventoryRegistry` (so `POST /api/hotel-bookings` stops answering `503`) and `ProviderDirectory` (so a hotel moderator can be linked to a hotel and a hotel can be deactivated; confirmed guests are notified).

**Search (issues 34, 35):** `HotelSearchService` (`src/hotels/search/`) reads reservations only through `HotelReservationQueries` and ratings through `HotelRatings`, and registers itself with `HotelSearchHook`, which is how `GET /api/itineraries/:id/hotels` reaches it. `GET hotels/:id` matches any single path segment, so `HotelSearchController` is listed **before** `HotelsController` in `HotelsModule`; keep it that way.

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
- `confirmPaid(bookingId, { paymentIntentId, amount, currency })` from the verified webhook only. Idempotent: a replayed webhook gets `already_confirmed`, or `already_processed` if the booking was cancelled since (do **not** refund again). Returns `rejected` with a reason (`HOLD_EXPIRED`, `AMOUNT_MISMATCH`, `FLIGHT_NOT_BOOKABLE`, ...) only when the payment must be refunded.
- `policiesFor(bookingId, userId)` for PAY-02 (cancellation tiers and baggage policy accepted at hold time)
- `refundQuote`, `refundBasis` and `recordRefundResult` for `RefundService` (PAY-03). If the airline cancelled one of the booking's flights, the quote is 100% (FLT-06) even if its cancellation has not reached the booking yet.

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

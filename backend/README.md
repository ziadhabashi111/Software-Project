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

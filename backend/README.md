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
npm run test:e2e        # e2e tests (no database needed)
npm run build
```

## What the scaffold already gives you

- Global `ValidationPipe` (whitelist, forbid unknown fields, transform) - just use DTOs with `class-validator`
- Global exception filter: every error is `{ statusCode, error, message, path, timestamp }`; Mongo duplicate keys become 409
- CORS for the frontend (`FRONTEND_URL`) with credentials, `cookie-parser` for httpOnly cookie auth
- Swagger with cookie auth (`access_token`) configured
- Empty placeholder module for every area below. **Add your code only inside your own folder in `src/`.**

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

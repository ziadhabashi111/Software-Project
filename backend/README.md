# Backend (NestJS + MongoDB Atlas)

Scaffold with `npx @nestjs/cli new .` inside this folder (first PR from the team lead), then add feature modules.

## Module ownership

| Module | Owner |
|---|---|
| auth, users, admin, audit | Habashi |
| airlines, flights (+ flight search), itinerary budgets / exchange rates | Youssef Wahby |
| flight-bookings (holds, e-ticket, cancel) | Yahia Tarek |
| payments, refunds, notifications, itineraries (structure) | Ziad Mohannad |
| hotel-bookings, reviews | Abdelrahman |
| hotels, rooms, availability (+ hotel search) | Amina |
| blog (posts, comments, likes, tags), uploads, seed script | Ahmed Ismail |

## Rules

- One folder per feature module: `module`, `controller`, `service`, `schemas`, `dto`
- Validate with DTOs + `class-validator`; protect routes with guards and ownership checks
- Document with Swagger decorators; reference requirement IDs

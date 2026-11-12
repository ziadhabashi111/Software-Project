# Frontend (Next.js + TypeScript)

Milestone 2 (deadline 11/12/2026). Scaffold with `npx create-next-app@latest .` once the backend is stable.

Each member builds the pages for their own backend module (see `PROJECT_BREAKDOWN.md`).

## Rendering strategy (be ready to justify)

| Page / feature | Strategy |
|---|---|
| Published blog post, public author page, public itinerary detail | ISR / static |
| Blog listing and search, public itinerary search, flight/hotel search | Dynamic SSR |
| Private itinerary, user bookings, admin/moderator dashboards | Dynamic SSR |
| Blog editor, itinerary editor | Dynamic SSR + client components |
| Likes and comments | Client components |

Public pages need SEO metadata. Frontend route protection never replaces backend authorization. Do not store tokens in localStorage/sessionStorage.

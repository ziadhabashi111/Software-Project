# Frontend (Next.js + TypeScript)

Milestone 2 (deadline 11/12/2026). Next.js 15 App Router scaffold is in place.

```bash
cd frontend
npm install
npm run dev      # http://localhost:3001 (backend runs on :3000)
npm run lint
npm run build
```

- `NEXT_PUBLIC_API_URL` (default `http://localhost:3000/api`) and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` go in `frontend/.env.local` (never commit it).
- Call the backend only through `lib/api.ts` (sends cookies with `credentials: 'include'`).
- Fonts use the system stack, so builds work offline.

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

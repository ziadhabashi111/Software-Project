---
name: add-api-endpoint
description: Use when adding or changing a Travel Platform NestJS API endpoint.
---

# Add API Endpoint

1. Read `specs/travel-platform.md`, `AGENTS.md` and the requirement IDs in the Excel sheet.
2. State route, input, output, validation, authorization (role and ownership) and service responsibility.
3. Preserve controller / service / schema / DTO separation.
4. Never modify `.env`. Do not add packages unless necessary.
5. For inventory or booking changes, state how concurrency is handled before coding.
6. Add Swagger decorators with examples and the requirement ID; add tests; run lint and tests.
7. Branch name `feature/<REQ-ID>-<description>`; commit `feat(<module>): ...`; log AI usage in `AI_PROMPTS.txt`.

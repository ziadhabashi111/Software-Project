# Reports (GEN-09) and blog moderation hooks (GEN-10)

Owner: Ahmed Ismail. Code: `backend/src/blog/reports/` and `backend/src/blog/blog-moderation.service.ts`.

## Submitting a report

`POST /api/reports` (signed in)

```json
{ "contentType": "post", "contentId": "6650f1c2a1b2c3d4e5f60789", "reason": "Spam" }
```

| Rule | Response |
|---|---|
| `contentType` is `post`, `comment`, `review` or `itinerary`; `contentId` is a valid id; `reason` is 1 to 500 characters (trimmed) | 400 with field errors |
| At most one report per user per item, enforced by a unique index `{ reporter, contentType, contentId }`, so parallel requests are safe too | 409, `code: ALREADY_REPORTED` |
| The item must exist and be visible to the reporter (a published post, a visible comment on a published post) | 404 |
| You cannot report your own content | 400 |

Returns `201 { id, contentType, contentId, reason, status: "open", createdAt }`.

## Report schema (`reports` collection)

`contentType`, `contentId`, `reporter`, `reason`, `status` (`open` or `resolved`), `resolution { action, admin, resolvedAt }`, timestamps.

`ReportsService` implements the admin module's `ReportSource` and registers itself with `ReportDirectory`. `GET /api/admin/reports` and `PATCH /api/admin/reports/:id` therefore work without any change to the admin module. `resolve` is atomic (`status: open` → `resolved`), so two admins can't both resolve the same report.

## Moderation hooks for posts and comments

Posts and comments have `isHidden`. `BlogModerationService` provides `hidePost`, `unhidePost`, `deletePost` (also deletes the post's comments), `hideComment`, `unhideComment` and `deleteComment` (also decrements the post's `commentCount`). Each is safe to call twice and returns `null` for an unknown id. The post and comment handlers are registered with the admin `ContentModerators`, so `DELETE /api/admin/content/post|comment/:id` works.

## Checking reviews and itineraries (Amina, Habashi)

At the moment, a review or itinerary report is accepted as long as the id is valid. Admin resolution already copes with content that no longer exists. To accept only items that exist and that the reporter can see (public or own itineraries, visible reviews), register a `ReportTarget` from your module. Import `BlogModule`, then:

```ts
import { ReportTargets } from '../blog/reports/report-targets';
import { ContentType } from '../admin/content-moderators';

onModuleInit() {
  this.reportTargets.register(ContentType.ITINERARY, {
    find: async (id, reporter) => {
      const itinerary = await this.repository.findById(id); // your own lookup
      if (!itinerary) return null;
      return {
        authorId: itinerary.owner.toString(),
        visibleToReporter: /* public, or the reporter's own, and not hidden */ true,
      };
    },
  });
}
```

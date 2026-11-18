# Image upload helper (GEN-08)

Owner: Ahmed Ismail. Code: `backend/src/uploads/`.

**Rule (GEN-08):** JPG or PNG only, up to 5 MB each. A post, activity or hotel can have up to 5 images, and an airline 1 logo. Files are stored on the server and served by URL. Anything outside these limits is rejected with a field error (`errors: [{ field: 'images', messages: [...] }]`) and nothing is stored.

The format is detected from the file's bytes, so a renamed file or a wrong `Content-Type` is rejected. Files are kept in memory until every check passes, then written under a random name (`<uuid>.png`). They are served read-only at `UPLOAD_PUBLIC_URL/<name>`, by default `http://localhost:3000/uploads/<name>`, outside the `/api` prefix.

**Ownership rule:** every stored file is recorded in the `uploads` collection with the user who uploaded it (`{ filename, url, ownerId, kind, createdAt }`). Only that user can reuse the URL or delete the file, so a moderator cannot point their airline or hotel at another provider's image, and cannot delete it by "replacing" it. Pass the signed-in user's id (`user.id` from `@CurrentUser()`) to every call below.

| Method | Behaviour |
|---|---|
| `saveImages(files, kind, ownerId, existing = 0)` | Validates, records `ownerId` as the uploader, writes the files. If writing fails, the files and records written so far are removed. |
| `isUploadedUrl(url, ownerId): Promise<boolean>` | True only for a URL this helper produced **and** `ownerId` uploaded. |
| `assertOwnedUpload(url, ownerId, field = 'images')` | Same check; throws a 400 field error on `field` otherwise. Use it to validate a client-sent URL. |
| `remove(urlOrId, ownerId): Promise<boolean>` | Deletes the file and its record only when `ownerId` uploaded it; returns true if deleted. Anything else (another user's file, an unknown or foreign URL) is a silent no-op returning false, so it is safe to call while cleaning up your own record. |

## Option A: attach images to your own record (posts, activities, hotels)

Import `UploadsModule` in your module, then:

```ts
import { UploadedFiles } from '@nestjs/common';
import { ImageUpload } from '../uploads/image-upload.decorator';
import { UploadsService } from '../uploads/uploads.service';

// controller
@Post(':id/images')
@ImageUpload() // multipart field "images", up to 5 files, 5 MB cap per file
addImages(
  @Param('id') id: string,
  @CurrentUser() user: AuthUser,
  @UploadedFiles() files: Express.Multer.File[] | undefined,
) {
  return this.activities.addImages(id, user, files);
}

// service: check ownership of the record first, then pass the uploader and
// the number of images you already have
const images = await this.uploads.saveImages(files, 'activity', user.id, activity.images.length);
activity.images.push(...images.map((image) => ({ url: image.url })));
await doc.save();

// removing an image: delete it from your record, then the file
await this.uploads.remove(image.url, user.id);
```

`saveImages(files, kind, ownerId, existing)` counts the existing images, so a 6th image is rejected. The kinds are `post`, `activity`, `hotel` (5 each) and `airlineLogo` (1).

When someone other than the uploader deletes the record (for example an admin removing a post under GEN-10), pass the **uploader's** id (the record's author/owner), not the acting user, so the files are still cleaned up. The blog does this: `BlogModerationService.deletePost` removes a post's images as `post.author`, and `POST /api/posts` accepts `imageUrls` only when the author uploaded each one.

Users: **Habashi** (ITN-12 activity images), **Abdelrahman** (HTL-01 hotel photos), **Ahmed** (BLG-10 post images).

## Option B: upload first, then save the URL (airline logo)

`POST /api/uploads/images?kind=airlineLogo`. This needs sign-in and a multipart field named `images`, and returns:

```json
{ "images": [{ "id": "3f1c...b8c.png", "url": "http://localhost:3000/uploads/3f1c...b8c.png" }] }
```

The client then sends the `url` as `logoUrl` in `PATCH /api/airlines/:id` (FLT-01). **Youssef:** inject `UploadsService` and, after checking the moderator manages that airline:

```ts
await this.uploads.assertOwnedUpload(dto.logoUrl, user.id, 'logoUrl'); // 400 unless this user uploaded it
const oldLogoUrl = airline.logoUrl;
airline.logoUrl = dto.logoUrl;
await airline.save();
if (oldLogoUrl) await this.uploads.remove(oldLogoUrl, user.id); // only deletes the caller's own file
```

If a different user uploaded the old logo (for example an admin, or a previous moderator), `remove` leaves that file in place rather than deleting someone else's upload.

`kind` defaults to `post` (up to 5 files per request).

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `UPLOAD_DIR` | `uploads` (relative to `backend/`, git-ignored) | At deployment, point it at a persistent disk |
| `UPLOAD_PUBLIC_URL` | `http://localhost:<PORT>/uploads` | Public base of the returned URLs, e.g. `https://api.example.com/uploads` |

All file access goes through `UploadsService`. Moving to cloud storage later (PROJECT_BREAKDOWN 15.3) only changes that one class.

# Image upload helper (GEN-08)

Owner: Ahmed Ismail. Code: `backend/src/uploads/`.

**Rule (GEN-08):** JPG or PNG only, up to 5 MB each. A post, activity or hotel can have up to 5 images, and an airline 1 logo. Files are stored on the server and served by URL. Anything outside these limits is rejected with a field error (`errors: [{ field: 'images', messages: [...] }]`) and nothing is stored.

The format is detected from the file's bytes, so a renamed file or a wrong `Content-Type` is rejected. Files are kept in memory until every check passes, then written under a random name (`<uuid>.png`). They are served read-only at `UPLOAD_PUBLIC_URL/<name>`, by default `http://localhost:3000/uploads/<name>`, outside the `/api` prefix.

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

// service: check ownership first, then pass the number of images you already have
const images = await this.uploads.saveImages(files, 'activity', activity.images.length);
activity.images.push(...images.map((image) => ({ url: image.url })));
await doc.save();

// removing an image: delete it from your record, then the file
await this.uploads.remove(image.url);
```

`saveImages(files, kind, existing)` counts the existing images, so a 6th image is rejected. The kinds are `post`, `activity`, `hotel` (5 each) and `airlineLogo` (1).

Users: **Habashi** (ITN-12 activity images), **Abdelrahman** (HTL-01 hotel photos), **Ahmed** (BLG-10 post images).

## Option B: upload first, then save the URL (airline logo)

`POST /api/uploads/images?kind=airlineLogo`. This needs sign-in and a multipart field named `images`, and returns:

```json
{ "images": [{ "id": "3f1c...b8c.png", "url": "http://localhost:3000/uploads/3f1c...b8c.png" }] }
```

The client then sends the `url` as `logoUrl` in `PATCH /api/airlines/:id` (FLT-01). **Youssef:** to accept only URLs from this helper, inject `UploadsService` and check `uploads.isUploadedUrl(dto.logoUrl)`. When the logo is replaced, call `uploads.remove(oldLogoUrl)`.

`kind` defaults to `post` (up to 5 files per request).

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `UPLOAD_DIR` | `uploads` (relative to `backend/`, git-ignored) | At deployment, point it at a persistent disk |
| `UPLOAD_PUBLIC_URL` | `http://localhost:<PORT>/uploads` | Public base of the returned URLs, e.g. `https://api.example.com/uploads` |

All file access goes through `UploadsService`. Moving to cloud storage later (PROJECT_BREAKDOWN 15.3) only changes that one class.

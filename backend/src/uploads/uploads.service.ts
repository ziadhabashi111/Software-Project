import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fieldError } from '../common/validation/validation-errors';
import {
  detectImageType,
  IMAGE_LIMITS,
  MAX_IMAGE_BYTES,
  type ImageOwnerKind,
} from './image-rules';

/** What a module stores for each image: an id to remove it and its URL. */
export interface StoredImage {
  id: string;
  url: string;
}

/** The parts of an uploaded file the helper needs (a Multer file fits). */
export interface ImageFile {
  buffer: Buffer;
  size: number;
}

/** URL path the files are served under (see UploadsModule). */
export const UPLOADS_ROUTE = '/uploads';

const STORED_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/;

/**
 * GEN-08: the one place that reads and writes uploaded images.
 *
 * Files go to `UPLOAD_DIR` (default `backend/uploads/`) under a random name
 * and are served at `UPLOAD_PUBLIC_URL/<name>`. Every rule is checked before
 * anything is written, so a request is stored completely or not at all.
 * Keeping all file access here means a persistent disk or cloud storage can
 * replace it at deployment without touching other modules.
 */
@Injectable()
export class UploadsService {
  readonly directory: string;
  private readonly publicBase: string;

  constructor(config: ConfigService) {
    this.directory = resolve(config.get<string>('UPLOAD_DIR') || 'uploads');
    const port = config.get<string>('PORT') || '3000';
    this.publicBase = (
      config.get<string>('UPLOAD_PUBLIC_URL') ||
      `http://localhost:${port}${UPLOADS_ROUTE}`
    ).replace(/\/+$/, '');
  }

  /**
   * Checks that `adding` more images fit next to the `existing` ones of a
   * post, activity, hotel or airline logo. Call it before saving.
   */
  assertCanAdd(kind: ImageOwnerKind, existing: number, adding: number): void {
    const limit = IMAGE_LIMITS[kind];
    if (existing + adding > limit) {
      const left = Math.max(limit - existing, 0);
      throw fieldError(
        'images',
        limit === 1
          ? `Only 1 image is allowed here${existing > 0 ? '; remove the current one first' : ''}`
          : `At most ${limit} images are allowed; you can add ${left} more`,
      );
    }
  }

  /**
   * Validates and stores the files (JPG/PNG, <= 5 MB each, count limit for
   * `kind` including `existing` images). Returns the new images in order.
   */
  async saveImages(
    files: ImageFile[] | undefined,
    kind: ImageOwnerKind,
    existing = 0,
  ): Promise<StoredImage[]> {
    if (!files || files.length === 0) {
      throw fieldError('images', 'Choose at least one JPG or PNG image');
    }
    this.assertCanAdd(kind, existing, files.length);

    const checked = files.map((file, index) => {
      const label = files.length > 1 ? `Image ${index + 1}` : 'The image';
      if (file.size > MAX_IMAGE_BYTES || file.buffer.length > MAX_IMAGE_BYTES) {
        throw fieldError('images', `${label} is larger than 5 MB`);
      }
      const type = detectImageType(file.buffer);
      if (!type) {
        throw fieldError('images', `${label} is not a JPG or PNG file`);
      }
      return { buffer: file.buffer, name: `${randomUUID()}.${type}` };
    });

    await mkdir(this.directory, { recursive: true });
    const written: string[] = [];
    try {
      for (const file of checked) {
        await writeFile(join(this.directory, file.name), file.buffer, {
          flag: 'wx',
        });
        written.push(file.name);
      }
    } catch (error) {
      await Promise.all(written.map((name) => this.unlinkQuietly(name)));
      throw error;
    }
    return checked.map((file) => ({
      id: file.name,
      url: this.urlFor(file.name),
    }));
  }

  /** True when the URL points to a file this helper stored. */
  isUploadedUrl(url: string): boolean {
    return this.nameFromUrl(url) !== null;
  }

  /**
   * Deletes a stored image by its URL or id. Unknown or foreign URLs are
   * ignored, so modules can call it safely when removing an image.
   */
  async remove(urlOrId: string): Promise<void> {
    const name = STORED_NAME.test(urlOrId)
      ? urlOrId
      : this.nameFromUrl(urlOrId);
    if (name) await this.unlinkQuietly(name);
  }

  private urlFor(name: string): string {
    return `${this.publicBase}/${name}`;
  }

  private nameFromUrl(url: string): string | null {
    const prefix = `${this.publicBase}/`;
    if (!url.startsWith(prefix)) return null;
    const name = url.slice(prefix.length);
    // Only our own random names: never a path such as ../../.env
    return STORED_NAME.test(name) ? name : null;
  }

  private async unlinkQuietly(name: string): Promise<void> {
    try {
      await unlink(join(this.directory, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

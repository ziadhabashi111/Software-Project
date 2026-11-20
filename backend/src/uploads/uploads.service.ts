import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
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
import { Upload } from './upload.schema';

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
 * Each file is recorded with the user who uploaded it (`Upload`), and only
 * that user can reuse its URL (`assertOwnedUpload`) or delete it (`remove`).
 * Keeping all file access here means a persistent disk or cloud storage can
 * replace it at deployment without touching other modules.
 */
@Injectable()
export class UploadsService {
  readonly directory: string;
  private readonly publicBase: string;

  constructor(
    config: ConfigService,
    @InjectModel(Upload.name) private readonly records: Model<Upload>,
  ) {
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
   * `kind` including `existing` images) and records `ownerId` (the signed-in
   * user's id) as their uploader. Returns the new images in order.
   */
  async saveImages(
    files: ImageFile[] | undefined,
    kind: ImageOwnerKind,
    ownerId: string,
    existing = 0,
    options: { standalone?: boolean } = {},
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
    const owner = new Types.ObjectId(ownerId);
    const names = checked.map((file) => file.name);
    const standalone = options.standalone === true;
    const now = new Date();
    // Record the owner first, then write the files; on any failure undo both
    // so there is never an unowned file or a record without its file.
    await this.records.insertMany(
      checked.map((file) => ({
        filename: file.name,
        url: this.urlFor(file.name),
        ownerId: owner,
        kind,
        standalone,
        // Saved straight onto an item: attached already. Stand-alone files
        // wait for `attach`.
        ...(standalone ? {} : { attachedAt: now }),
      })),
    );
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
      await this.records.deleteMany({ filename: { $in: names } });
      throw error;
    }
    return checked.map((file) => ({
      id: file.name,
      url: this.urlFor(file.name),
    }));
  }

  /**
   * True only when the URL points to a file this helper stored AND `ownerId`
   * uploaded it. Another user's upload, a foreign URL or a made-up name is
   * false.
   */
  async isUploadedUrl(url: string, ownerId: string): Promise<boolean> {
    const name = this.nameFromUrl(url);
    if (!name || !isValidObjectId(ownerId)) return false;
    const found = await this.records.exists({
      filename: name,
      ownerId: new Types.ObjectId(ownerId),
    });
    return found !== null;
  }

  /**
   * Claims stand-alone uploads for one item (a post's `imageUrls`, an airline
   * `logoUrl`): each URL must be a file `ownerId` uploaded that no item uses
   * yet. All or nothing: on any bad URL nothing stays claimed and a 400 field
   * error is thrown on `field`. A claimed file is never removed by the cleanup.
   */
  async attach(
    urls: string[],
    ownerId: string,
    field = 'images',
  ): Promise<void> {
    const refuse = () =>
      fieldError(
        field,
        'Each image must be one you uploaded through POST /api/uploads/images and not used anywhere else',
      );
    if (urls.length === 0) return;
    const names = urls.map((url) => this.nameFromUrl(url));
    if (names.some((name) => name === null) || !isValidObjectId(ownerId)) {
      throw refuse();
    }
    const owner = new Types.ObjectId(ownerId);
    const claimed: string[] = [];
    for (const name of names as string[]) {
      const result = await this.records.updateOne(
        { filename: name, ownerId: owner, attachedAt: { $exists: false } },
        { $set: { attachedAt: new Date() } },
      );
      if (result.modifiedCount !== 1) {
        await this.detach(claimed);
        throw refuse();
      }
      claimed.push(name);
    }
  }

  /** Undoes `attach` (for example when saving the item then fails). */
  async detach(urlsOrNames: string[]): Promise<void> {
    const names = urlsOrNames
      .map((value) =>
        STORED_NAME.test(value) ? value : this.nameFromUrl(value),
      )
      .filter((name): name is string => name !== null);
    if (names.length === 0) return;
    await this.records.updateMany(
      { filename: { $in: names } },
      { $unset: { attachedAt: 1 } },
    );
  }

  /**
   * Use before saving a client-sent URL (e.g. an airline `logoUrl`): throws a
   * 400 field error on `field` unless `ownerId` uploaded that file.
   */
  async assertOwnedUpload(
    url: string,
    ownerId: string,
    field = 'images',
  ): Promise<void> {
    if (!(await this.isUploadedUrl(url, ownerId))) {
      throw fieldError(
        field,
        'Use an image you uploaded through POST /api/uploads/images',
      );
    }
  }

  /**
   * Deletes a stored image by its URL or id, but only when `ownerId` uploaded
   * it. Anything else (another user's file, an unknown or foreign URL) is a
   * no-op, so modules can call it safely while removing an image from their
   * own record. Returns true when a file was deleted.
   */
  async remove(urlOrId: string, ownerId: string): Promise<boolean> {
    const name = STORED_NAME.test(urlOrId)
      ? urlOrId
      : this.nameFromUrl(urlOrId);
    if (!name || !isValidObjectId(ownerId)) return false;
    const record = await this.records.findOneAndDelete({
      filename: name,
      ownerId: new Types.ObjectId(ownerId),
    });
    if (!record) return false;
    await this.unlinkQuietly(name);
    return true;
  }

  /**
   * Deletes the file of an image its item no longer shows, whoever uploaded
   * it. For modules that have just removed the URL from their own record
   * after checking the caller may change that item (for example any
   * moderator of the hotel, GEN-08, HTL-01): a file belongs to one item only
   * (`attach`), so nothing else uses it. Unknown or foreign URLs are a no-op.
   */
  async removeForItem(urlOrId: string): Promise<boolean> {
    const name = STORED_NAME.test(urlOrId)
      ? urlOrId
      : this.nameFromUrl(urlOrId);
    if (!name) return false;
    const record = await this.records.findOneAndDelete({ filename: name });
    if (!record) return false;
    await this.unlinkQuietly(name);
    return true;
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

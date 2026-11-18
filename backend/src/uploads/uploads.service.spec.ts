import { ConfigService } from '@nestjs/config';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Model } from 'mongoose';
import { detectImageType, MAX_IMAGE_BYTES } from './image-rules';
import type { Upload } from './upload.schema';
import { UploadsService, type ImageFile } from './uploads.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const file = (buffer: Buffer, size = buffer.length): ImageFile => ({
  buffer,
  size,
});

const ALICE = '64b7f0c2a1b2c3d4e5f60001';
const BOB = '64b7f0c2a1b2c3d4e5f60002';

function messagesOf(error: unknown): string[] {
  const body = (error as { getResponse(): unknown }).getResponse() as {
    errors: { messages: string[] }[];
  };
  return body.errors.flatMap((e) => e.messages);
}

async function expectRejected(
  run: Promise<unknown>,
  message: RegExp,
): Promise<void> {
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).not.toBeNull();
  expect(messagesOf(error).join(' ')).toMatch(message);
}

interface UploadRow {
  filename: string;
  url: string;
  ownerId: { toString(): string };
  kind: string;
}

interface UploadFilter {
  filename: string | { $in: string[] };
  ownerId?: { toString(): string };
}

/** An in-memory stand-in for the `Upload` model (the e2e uses real MongoDB). */
class FakeUploadModel {
  rows: UploadRow[] = [];

  private matches(row: UploadRow, filter: UploadFilter): boolean {
    const name =
      typeof filter.filename === 'string'
        ? row.filename === filter.filename
        : filter.filename.$in.includes(row.filename);
    const owner =
      !filter.ownerId || row.ownerId.toString() === filter.ownerId.toString();
    return name && owner;
  }

  insertMany(rows: UploadRow[]): Promise<UploadRow[]> {
    this.rows.push(...rows);
    return Promise.resolve(rows);
  }

  deleteMany(filter: UploadFilter): Promise<{ deletedCount: number }> {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !this.matches(row, filter));
    return Promise.resolve({ deletedCount: before - this.rows.length });
  }

  exists(filter: UploadFilter): Promise<{ _id: string } | null> {
    const found = this.rows.find((row) => this.matches(row, filter));
    return Promise.resolve(found ? { _id: found.filename } : null);
  }

  findOneAndDelete(filter: UploadFilter): Promise<UploadRow | null> {
    const found = this.rows.find((row) => this.matches(row, filter));
    if (found) this.rows = this.rows.filter((row) => row !== found);
    return Promise.resolve(found ?? null);
  }
}

describe('detectImageType (GEN-08)', () => {
  it('recognises JPG and PNG by their first bytes', () => {
    expect(detectImageType(JPG)).toBe('jpg');
    expect(detectImageType(PNG)).toBe('png');
  });

  it('rejects other formats even if named .png', () => {
    expect(detectImageType(Buffer.from('GIF89a'))).toBeNull();
    expect(detectImageType(Buffer.from('MZ executable'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('UploadsService (GEN-08)', () => {
  let dir: string;
  let records: FakeUploadModel;
  let uploads: UploadsService;

  const build = (config: Record<string, string>): UploadsService =>
    new UploadsService(
      new ConfigService(config),
      records as unknown as Model<Upload>,
    );

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uploads-spec-'));
    records = new FakeUploadModel();
    uploads = build({
      UPLOAD_DIR: dir,
      UPLOAD_PUBLIC_URL: 'http://cdn.test/uploads/',
    });
  });

  afterEach(async () => {
    await chmod(dir, 0o700);
    await rm(dir, { recursive: true, force: true });
  });

  it('stores JPG and PNG files, returns their URLs and records the uploader', async () => {
    const images = await uploads.saveImages(
      [file(JPG), file(PNG)],
      'post',
      ALICE,
    );
    expect(images).toHaveLength(2);
    expect(images[0].url).toBe(`http://cdn.test/uploads/${images[0].id}`);
    expect(images[0].id).toMatch(/\.jpg$/);
    expect(images[1].id).toMatch(/\.png$/);
    expect(readdirSync(dir).sort()).toEqual(images.map((i) => i.id).sort());
    expect(
      records.rows.map((r) => [r.filename, r.ownerId.toString(), r.kind]),
    ).toEqual(images.map((i) => [i.id, ALICE, 'post']));
  });

  it('rejects a file that is not JPG or PNG and stores nothing', async () => {
    await expectRejected(
      uploads.saveImages(
        [file(PNG), file(Buffer.from('GIF89a'))],
        'post',
        ALICE,
      ),
      /Image 2 is not a JPG or PNG file/,
    );
    expect(readdirSync(dir)).toEqual([]);
    expect(records.rows).toEqual([]);
  });

  it('leaves no upload record behind when writing the file fails', async () => {
    await chmod(dir, 0o500); // read-only folder: the write fails
    await expect(
      uploads.saveImages([file(PNG), file(JPG)], 'post', ALICE),
    ).rejects.toThrow();
    expect(records.rows).toEqual([]);
    await chmod(dir, 0o700);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('rejects a file larger than 5 MB', async () => {
    await expectRejected(
      uploads.saveImages([file(PNG, MAX_IMAGE_BYTES + 1)], 'hotel', ALICE),
      /larger than 5 MB/,
    );
  });

  it('accepts a file of exactly 5 MB', async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES);
    PNG.copy(big);
    await expect(
      uploads.saveImages([file(big)], 'hotel', ALICE),
    ).resolves.toHaveLength(1);
  });

  it('rejects an empty request', async () => {
    await expectRejected(uploads.saveImages([], 'post', ALICE), /at least one/);
    await expectRejected(
      uploads.saveImages(undefined, 'post', ALICE),
      /at least one/,
    );
  });

  it('enforces 5 images per post, activity or hotel, counting existing ones', async () => {
    const six = Array.from({ length: 6 }, () => file(PNG));
    await expectRejected(
      uploads.saveImages(six, 'activity', ALICE),
      /At most 5/,
    );
    await expectRejected(
      uploads.saveImages([file(PNG), file(PNG)], 'post', ALICE, 4),
      /you can add 1 more/,
    );
    await expect(
      uploads.saveImages([file(PNG)], 'post', ALICE, 4),
    ).resolves.toHaveLength(1);
  });

  it('allows only 1 airline logo', async () => {
    await expectRejected(
      uploads.saveImages([file(PNG), file(JPG)], 'airlineLogo', ALICE),
      /Only 1 image/,
    );
    await expectRejected(
      uploads.saveImages([file(PNG)], 'airlineLogo', ALICE, 1),
      /remove the current one first/,
    );
  });

  it("removes the owner's files by URL or id and ignores anything else", async () => {
    const [a, b] = await uploads.saveImages(
      [file(PNG), file(JPG)],
      'post',
      ALICE,
    );
    await expect(uploads.remove(a.url, ALICE)).resolves.toBe(true);
    await expect(uploads.remove(b.id, ALICE)).resolves.toBe(true);
    expect(readdirSync(dir)).toEqual([]);
    expect(records.rows).toEqual([]);

    await expect(uploads.remove(a.url, ALICE)).resolves.toBe(false); // gone
    await expect(
      uploads.remove('http://cdn.test/uploads/../../.env', ALICE),
    ).resolves.toBe(false);
    await expect(
      uploads.remove('https://evil.test/x.png', ALICE),
    ).resolves.toBe(false);
  });

  it("never removes another user's file", async () => {
    const [image] = await uploads.saveImages([file(PNG)], 'airlineLogo', ALICE);
    await expect(uploads.remove(image.url, BOB)).resolves.toBe(false);
    await expect(uploads.remove(image.id, BOB)).resolves.toBe(false);
    await expect(uploads.remove(image.url, 'not-an-id')).resolves.toBe(false);
    expect(readdirSync(dir)).toEqual([image.id]);
    expect(records.rows).toHaveLength(1);
  });

  it('accepts an uploaded URL only for the user who uploaded it', async () => {
    const [image] = await uploads.saveImages([file(PNG)], 'post', ALICE);
    await expect(uploads.isUploadedUrl(image.url, ALICE)).resolves.toBe(true);
    await expect(uploads.isUploadedUrl(image.url, BOB)).resolves.toBe(false);
    await expect(
      uploads.assertOwnedUpload(image.url, ALICE, 'logoUrl'),
    ).resolves.toBeUndefined();
    await expectRejected(
      uploads.assertOwnedUpload(image.url, BOB, 'logoUrl'),
      /Use an image you uploaded/,
    );
  });

  it('recognises only URLs it produced', async () => {
    const [image] = await uploads.saveImages([file(PNG)], 'post', ALICE);
    await expect(
      uploads.isUploadedUrl('http://cdn.test/uploads/logo.png', ALICE),
    ).resolves.toBe(false);
    await expect(
      uploads.isUploadedUrl(`https://other.test/uploads/${image.id}`, ALICE),
    ).resolves.toBe(false);
    await expect(
      uploads.isUploadedUrl(
        'http://cdn.test/uploads/3f1c2b9e-8a7d-4c1e-9b2a-1d4e5f6a7b8c.png',
        ALICE,
      ),
    ).resolves.toBe(false); // well-formed name, but never stored
  });

  it('defaults to backend/uploads and localhost', async () => {
    const fallback = build({ PORT: '4000' });
    expect(fallback.directory).toBe(join(process.cwd(), 'uploads'));
    await expect(
      fallback.isUploadedUrl('http://localhost:4000/uploads/x', ALICE),
    ).resolves.toBe(false);
    expect(existsSync(dir)).toBe(true);
  });
});

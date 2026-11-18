import { ConfigService } from '@nestjs/config';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectImageType, MAX_IMAGE_BYTES } from './image-rules';
import { UploadsService, type ImageFile } from './uploads.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const file = (buffer: Buffer, size = buffer.length): ImageFile => ({
  buffer,
  size,
});

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
  let uploads: UploadsService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uploads-spec-'));
    uploads = new UploadsService(
      new ConfigService({
        UPLOAD_DIR: dir,
        UPLOAD_PUBLIC_URL: 'http://cdn.test/uploads/',
      }),
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores JPG and PNG files and returns their URLs', async () => {
    const images = await uploads.saveImages([file(JPG), file(PNG)], 'post');
    expect(images).toHaveLength(2);
    expect(images[0].url).toBe(`http://cdn.test/uploads/${images[0].id}`);
    expect(images[0].id).toMatch(/\.jpg$/);
    expect(images[1].id).toMatch(/\.png$/);
    expect(readdirSync(dir).sort()).toEqual(images.map((i) => i.id).sort());
  });

  it('rejects a file that is not JPG or PNG and stores nothing', async () => {
    await expectRejected(
      uploads.saveImages([file(PNG), file(Buffer.from('GIF89a'))], 'post'),
      /Image 2 is not a JPG or PNG file/,
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it('rejects a file larger than 5 MB', async () => {
    await expectRejected(
      uploads.saveImages([file(PNG, MAX_IMAGE_BYTES + 1)], 'hotel'),
      /larger than 5 MB/,
    );
  });

  it('accepts a file of exactly 5 MB', async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES);
    PNG.copy(big);
    await expect(
      uploads.saveImages([file(big)], 'hotel'),
    ).resolves.toHaveLength(1);
  });

  it('rejects an empty request', async () => {
    await expectRejected(uploads.saveImages([], 'post'), /at least one/);
    await expectRejected(uploads.saveImages(undefined, 'post'), /at least one/);
  });

  it('enforces 5 images per post, activity or hotel, counting existing ones', async () => {
    const six = Array.from({ length: 6 }, () => file(PNG));
    await expectRejected(uploads.saveImages(six, 'activity'), /At most 5/);
    await expectRejected(
      uploads.saveImages([file(PNG), file(PNG)], 'post', 4),
      /you can add 1 more/,
    );
    await expect(
      uploads.saveImages([file(PNG)], 'post', 4),
    ).resolves.toHaveLength(1);
  });

  it('allows only 1 airline logo', async () => {
    await expectRejected(
      uploads.saveImages([file(PNG), file(JPG)], 'airlineLogo'),
      /Only 1 image/,
    );
    await expectRejected(
      uploads.saveImages([file(PNG)], 'airlineLogo', 1),
      /remove the current one first/,
    );
  });

  it('removes its own files by URL or id and ignores anything else', async () => {
    const [a, b] = await uploads.saveImages([file(PNG), file(JPG)], 'post');
    await uploads.remove(a.url);
    await uploads.remove(b.id);
    expect(readdirSync(dir)).toEqual([]);

    await expect(uploads.remove(a.url)).resolves.toBeUndefined(); // already gone
    await expect(
      uploads.remove('http://cdn.test/uploads/../../.env'),
    ).resolves.toBeUndefined();
    await expect(
      uploads.remove('https://evil.test/x.png'),
    ).resolves.toBeUndefined();
  });

  it('recognises only URLs it produced', async () => {
    const [image] = await uploads.saveImages([file(PNG)], 'post');
    expect(uploads.isUploadedUrl(image.url)).toBe(true);
    expect(uploads.isUploadedUrl('http://cdn.test/uploads/logo.png')).toBe(
      false,
    );
    expect(
      uploads.isUploadedUrl(`https://other.test/uploads/${image.id}`),
    ).toBe(false);
  });

  it('defaults to backend/uploads and localhost', () => {
    const fallback = new UploadsService(new ConfigService({ PORT: '4000' }));
    expect(fallback.directory).toBe(join(process.cwd(), 'uploads'));
    expect(fallback.isUploadedUrl('http://localhost:4000/uploads/x')).toBe(
      false,
    );
    expect(existsSync(dir)).toBe(true);
  });
});

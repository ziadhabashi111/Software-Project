import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import request from 'supertest';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { UploadsModule } from '../src/uploads/uploads.module';
import { Upload } from '../src/uploads/upload.schema';
import {
  UploadsService,
  type StoredImage,
} from '../src/uploads/uploads.service';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

interface ErrorBody {
  errors?: { field: string; messages: string[] }[];
}

const messages = (body: unknown): string =>
  ((body as ErrorBody).errors ?? []).flatMap((e) => e.messages).join(' ');

describe('Image upload helper (GEN-08, real HTTP)', () => {
  let ctx: TestApp;
  let dir: string;
  let cookie: string[];
  let modCookie: string[];
  let aliceId: string;
  let modId: string;
  let bobId: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uploads-e2e-'));
    process.env.UPLOAD_DIR = dir;
    process.env.UPLOAD_PUBLIC_URL = 'http://localhost:3000/uploads';
    ctx = await createTestApp({ extraModules: [UploadsModule] });

    const users = ctx.moduleRef.get(UsersService);
    const passwords = ctx.moduleRef.get(PasswordService);
    const passwordHash = await passwords.hash('Passw0rd!');
    const alice = await users.create({
      name: 'Uploader',
      email: 'uploader@example.com',
      passwordHash,
    });
    const bob = await users.create({
      name: 'Other moderator',
      email: 'other@example.com',
      passwordHash,
    });
    const mod = await users.create({
      name: 'Airline moderator',
      email: 'airline-mod@example.com',
      passwordHash,
      role: Role.AIRLINE_MODERATOR,
    });
    aliceId = alice._id.toString();
    bobId = bob._id.toString();
    modId = mod._id.toString();
    const login = await request(ctx.server)
      .post('/api/auth/login')
      .send({ email: 'uploader@example.com', password: 'Passw0rd!' })
      .expect(200);
    cookie = login.get('Set-Cookie') ?? [];
    const modLogin = await request(ctx.server)
      .post('/api/auth/login')
      .send({ email: 'airline-mod@example.com', password: 'Passw0rd!' })
      .expect(200);
    modCookie = modLogin.get('Set-Cookie') ?? [];
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
    delete process.env.UPLOAD_DIR;
    delete process.env.UPLOAD_PUBLIC_URL;
    await rm(dir, { recursive: true, force: true });
  });

  it('requires sign-in', async () => {
    await request(ctx.server)
      .post('/api/uploads/images')
      .attach('images', PNG, 'a.png')
      .expect(401);
  });

  it('stores JPG/PNG files and serves them by URL', async () => {
    const res = await request(ctx.server)
      .post('/api/uploads/images')
      .set('Cookie', cookie)
      .attach('images', PNG, 'a.png')
      .attach('images', JPG, 'b.jpg')
      .expect(201);
    const { images } = res.body as { images: StoredImage[] };
    expect(images).toHaveLength(2);
    expect(images[0].url).toMatch(
      /^http:\/\/localhost:3000\/uploads\/.+\.png$/,
    );

    const served = await request(ctx.server)
      .get(`/uploads/${images[0].id}`)
      .expect(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(served.body as Buffer)).toEqual(PNG);
  });

  it('rejects a disguised file and stores nothing', async () => {
    const before = await readdir(dir);
    const res = await request(ctx.server)
      .post('/api/uploads/images')
      .set('Cookie', cookie)
      .attach('images', Buffer.from('MZ not an image'), 'photo.png')
      .expect(400);
    expect(messages(res.body)).toMatch(/not a JPG or PNG/);
    expect(await readdir(dir)).toEqual(before);
  });

  it('rejects files over 5 MB with a clear error', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1);
    PNG.copy(big);
    const res = await request(ctx.server)
      .post('/api/uploads/images')
      .set('Cookie', cookie)
      .attach('images', big, 'big.png')
      .expect(400);
    expect(messages(res.body)).toMatch(/5 MB or smaller/);
  });

  it('rejects more than 5 images, and more than 1 airline logo', async () => {
    let req = request(ctx.server)
      .post('/api/uploads/images')
      .set('Cookie', cookie);
    for (let i = 0; i < 6; i++) req = req.attach('images', PNG, `${i}.png`);
    const tooMany = await req.expect(400);
    expect(messages(tooMany.body)).toMatch(/at most 5 images/);

    const logos = await request(ctx.server)
      .post('/api/uploads/images?kind=airlineLogo')
      .set('Cookie', modCookie)
      .attach('images', PNG, 'a.png')
      .attach('images', PNG, 'b.png')
      .expect(400);
    expect(messages(logos.body)).toMatch(/Only 1 image/);

    await request(ctx.server)
      .post('/api/uploads/images?kind=airlineLogo')
      .set('Cookie', modCookie)
      .attach('images', PNG, 'logo.png')
      .expect(201);
  });

  it('rejects a missing file and an unknown kind', async () => {
    const none = await request(ctx.server)
      .post('/api/uploads/images')
      .set('Cookie', cookie)
      .field('note', 'nothing attached')
      .expect(400);
    expect(none.status).toBe(400);

    await request(ctx.server)
      .post('/api/uploads/images?kind=banner')
      .set('Cookie', cookie)
      .attach('images', PNG, 'a.png')
      .expect(400);
  });

  it('lets each role upload only for what it owns (airline logo: airline moderator; post or activity: user)', async () => {
    const userLogo = await request(ctx.server)
      .post('/api/uploads/images?kind=airlineLogo')
      .set('Cookie', cookie)
      .attach('images', PNG, 'logo.png')
      .expect(403);
    expect(userLogo.status).toBe(403);
    await request(ctx.server)
      .post('/api/uploads/images?kind=hotel')
      .set('Cookie', cookie)
      .attach('images', PNG, 'h.png')
      .expect(403);
    await request(ctx.server)
      .post('/api/uploads/images?kind=post')
      .set('Cookie', modCookie)
      .attach('images', PNG, 'p.png')
      .expect(403);
    await request(ctx.server)
      .post('/api/uploads/images?kind=activity')
      .set('Cookie', cookie)
      .attach('images', PNG, 'a.png')
      .expect(201);
  });

  it('never serves files outside the upload folder', async () => {
    await request(ctx.server)
      .get('/uploads/..%2F..%2Fpackage.json')
      .expect(404);
    await request(ctx.server).get('/uploads/.env').expect(404);
  });

  it('deletes stand-alone uploads nobody attached within a day, and keeps the rest (GEN-08)', async () => {
    const uploads = ctx.moduleRef.get(UploadsService);
    const records = ctx.moduleRef.get<Model<Upload>>(
      getModelToken(Upload.name),
    );
    const send = async (kind: string, as: string[]) =>
      (
        (
          await request(ctx.server)
            .post(`/api/uploads/images?kind=${kind}`)
            .set('Cookie', as)
            .attach('images', PNG, 'x.png')
            .expect(201)
        ).body as { images: StoredImage[] }
      ).images[0];
    const abandoned = await send('post', cookie);
    const used = await send('post', cookie);
    const recent = await send('post', cookie);
    const logo = await send('airlineLogo', modCookie);
    await uploads.attach([used.url], aliceId);

    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await records.collection.updateMany(
      { filename: { $in: [abandoned.id, used.id, logo.id] } },
      { $set: { createdAt: dayAgo } },
    );

    await expect(uploads.removeUnattached()).resolves.toBe(1);
    const left = await readdir(dir);
    expect(left).not.toContain(abandoned.id);
    expect(left).toEqual(expect.arrayContaining([used.id, recent.id, logo.id]));
    expect(await records.exists({ filename: abandoned.id })).toBeNull();
    await expect(
      uploads.attach([abandoned.url], aliceId),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses more than 20 unused stand-alone uploads per user (GEN-08)', async () => {
    const users = ctx.moduleRef.get(UsersService);
    const passwords = ctx.moduleRef.get(PasswordService);
    await users.create({
      name: 'Hoarder',
      email: 'hoarder@example.com',
      passwordHash: await passwords.hash('Passw0rd!'),
    });
    const login = await request(ctx.server)
      .post('/api/auth/login')
      .send({ email: 'hoarder@example.com', password: 'Passw0rd!' })
      .expect(200);
    const hoarder = login.get('Set-Cookie') ?? [];
    const batch = () => {
      let req = request(ctx.server)
        .post('/api/uploads/images?kind=post')
        .set('Cookie', hoarder);
      for (let i = 0; i < 5; i += 1)
        req = req.attach('images', PNG, `${i}.png`);
      return req;
    };
    for (let i = 0; i < 4; i += 1) await batch().expect(201);
    const refused = await batch().expect(409);
    expect((refused.body as { code?: string }).code).toBe(
      'TOO_MANY_UNUSED_UPLOADS',
    );
  });

  it('keeps cleaning until every abandoned upload is gone, not just one batch (GEN-08)', async () => {
    const uploads = ctx.moduleRef.get(UploadsService);
    const records = ctx.moduleRef.get<Model<Upload>>(
      getModelToken(Upload.name),
    );
    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await records.collection.insertMany(
      Array.from({ length: 150 }, () => ({
        filename: `${randomUUID()}.png`,
        url: 'http://localhost:3000/uploads/x.png',
        ownerId: new Types.ObjectId(aliceId),
        kind: 'post',
        standalone: true,
        createdAt: dayAgo,
        updatedAt: dayAgo,
      })),
    );
    await expect(uploads.removeUnattached()).resolves.toBeGreaterThanOrEqual(
      150,
    );
    expect(
      await records.countDocuments({
        standalone: true,
        attachedAt: { $exists: false },
        kind: 'post',
        createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),
    ).toBe(0);
  });

  describe('ownership (GEN-08: only the uploader may reuse or delete a file)', () => {
    let logo: StoredImage;

    beforeAll(async () => {
      const res = await request(ctx.server)
        .post('/api/uploads/images?kind=airlineLogo')
        .set('Cookie', modCookie)
        .attach('images', PNG, 'logo.png')
        .expect(201);
      [logo] = (res.body as { images: StoredImage[] }).images;
    });

    it("records the signed-in user as the file's owner", async () => {
      const records = ctx.moduleRef.get<Model<Upload>>(
        getModelToken(Upload.name),
      );
      const record = await records.findOne({ filename: logo.id }).lean();
      expect(record?.ownerId.toString()).toBe(modId);
      expect(record?.kind).toBe('airlineLogo');
      expect(record?.url).toBe(logo.url);
    });

    it("accepts the uploader's URL and rejects it for anyone else", async () => {
      const uploads = ctx.moduleRef.get(UploadsService);
      await expect(uploads.isUploadedUrl(logo.url, modId)).resolves.toBe(true);
      await expect(uploads.isUploadedUrl(logo.url, bobId)).resolves.toBe(false);
      await expect(uploads.isUploadedUrl(logo.url, aliceId)).resolves.toBe(
        false,
      );
      await expect(
        uploads.assertOwnedUpload(logo.url, bobId, 'logoUrl'),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('does not let another user delete the file', async () => {
      const uploads = ctx.moduleRef.get(UploadsService);
      await expect(uploads.remove(logo.url, bobId)).resolves.toBe(false);
      expect(await readdir(dir)).toContain(logo.id);
      await request(ctx.server).get(`/uploads/${logo.id}`).expect(200);

      await expect(uploads.remove(logo.url, modId)).resolves.toBe(true);
      expect(await readdir(dir)).not.toContain(logo.id);
      await request(ctx.server).get(`/uploads/${logo.id}`).expect(404);
    });

    it('leaves no upload record when writing the file fails', async () => {
      const records = ctx.moduleRef.get<Model<Upload>>(
        getModelToken(Upload.name),
      );
      const before = await records.countDocuments();
      await chmod(dir, 0o500); // read-only folder: the write fails
      try {
        await request(ctx.server)
          .post('/api/uploads/images')
          .set('Cookie', cookie)
          .attach('images', PNG, 'a.png')
          .expect(500);
      } finally {
        await chmod(dir, 0o700);
      }
      expect(await records.countDocuments()).toBe(before);
    });
  });
});

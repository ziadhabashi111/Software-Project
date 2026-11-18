import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { PasswordService } from '../src/auth/password.service';
import { UploadsModule } from '../src/uploads/uploads.module';
import type { StoredImage } from '../src/uploads/uploads.service';
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

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uploads-e2e-'));
    process.env.UPLOAD_DIR = dir;
    process.env.UPLOAD_PUBLIC_URL = 'http://localhost:3000/uploads';
    ctx = await createTestApp({ extraModules: [UploadsModule] });

    const users = ctx.moduleRef.get(UsersService);
    const passwords = ctx.moduleRef.get(PasswordService);
    await users.create({
      name: 'Uploader',
      email: 'uploader@example.com',
      passwordHash: await passwords.hash('Passw0rd!'),
    });
    const login = await request(ctx.server)
      .post('/api/auth/login')
      .send({ email: 'uploader@example.com', password: 'Passw0rd!' })
      .expect(200);
    cookie = login.get('Set-Cookie') ?? [];
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
      .set('Cookie', cookie)
      .attach('images', PNG, 'a.png')
      .attach('images', PNG, 'b.png')
      .expect(400);
    expect(messages(logos.body)).toMatch(/Only 1 image/);

    await request(ctx.server)
      .post('/api/uploads/images?kind=airlineLogo')
      .set('Cookie', cookie)
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

  it('never serves files outside the upload folder', async () => {
    await request(ctx.server)
      .get('/uploads/..%2F..%2Fpackage.json')
      .expect(404);
    await request(ctx.server).get('/uploads/.env').expect(404);
  });
});

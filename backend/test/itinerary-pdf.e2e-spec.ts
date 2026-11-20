import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { formatDate } from '../src/hotel-bookings/stay-rules';
import { ItinerariesModule } from '../src/itineraries/itineraries.module';
import { PlaceCatalog } from '../src/itineraries/places';
import {
  Itinerary,
  ItineraryDocument,
} from '../src/itineraries/schemas/itinerary.schema';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';

type Agent = ReturnType<typeof request.agent>;

const day = (offset: number): string =>
  formatDate(new Date(Date.now() + offset * 86_400_000));

describe('Itinerary PDF export (ITN-28; real MongoDB in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let itineraryModel: Model<ItineraryDocument>;
  let counter = 0;

  beforeAll(async () => {
    ctx = await createTestApp({
      extraModules: [AuditModule, AdminModule, ItinerariesModule],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    itineraryModel = ctx.moduleRef.get<Model<ItineraryDocument>>(
      getModelToken(Itinerary.name),
    );
    // The reference-data module is not part of this app: stand in for it.
    ctx.moduleRef.get(PlaceCatalog).register({
      isCountry: () => Promise.resolve(true),
      isCity: () => Promise.resolve(true),
      matchKeyword: () => Promise.resolve({ countryCodes: [], cityIds: [] }),
    });
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  async function loggedInAs(
    role: Role = Role.USER,
  ): Promise<{ id: string; client: Agent }> {
    counter += 1;
    const email = `pdf${counter}@example.com`;
    const doc = await users.create({
      name: `Pdf Person ${counter}`,
      email,
      passwordHash: await passwords.hash(PASSWORD),
      role,
    });
    const client = request.agent(ctx.server);
    await client
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { id: doc.id, client };
  }

  const guest = () => request(ctx.server);

  async function itineraryOf(
    client: Agent,
    options: { title?: string; visibility?: 'public' | 'private' } = {},
  ): Promise<string> {
    const created = (
      await client
        .post('/api/itineraries')
        .send({
          title: options.title ?? 'Summer in Egypt',
          countries: ['EG'],
          startDate: day(10),
        })
        .expect(201)
    ).body as { id: string };
    await client
      .post(`/api/itineraries/${created.id}/days`)
      .send({ city: 'cairo' })
      .expect(201);
    if (options.visibility === 'public') {
      await client
        .patch(`/api/itineraries/${created.id}`)
        .send({ visibility: 'public' })
        .expect(200);
    }
    return created.id;
  }

  /** supertest buffers binary bodies only when asked to. */
  const binary = (res: request.Test): request.Test =>
    res.buffer(true).parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });

  it('lets the owner download their itinerary as a PDF attachment', async () => {
    const owner = await loggedInAs();
    const id = await itineraryOf(owner.client);
    const res = await binary(owner.client.get(`/api/itineraries/${id}/pdf`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="itinerary-summer-in-egypt.pdf"',
    );
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(1000);
  });

  it('never lets a title break the Content-Disposition header', async () => {
    const owner = await loggedInAs();
    const id = await itineraryOf(owner.client, {
      title: 'Trip "of" a; lifetime/../x',
    });
    const res = await binary(owner.client.get(`/api/itineraries/${id}/pdf`));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="itinerary-trip-of-a-lifetime-x.pdf"',
    );
  });

  it('keeps a private itinerary private: 404 for guests, other users and admins', async () => {
    const owner = await loggedInAs();
    const id = await itineraryOf(owner.client);
    const other = await loggedInAs();
    const admin = await loggedInAs(Role.ADMIN);
    await guest().get(`/api/itineraries/${id}/pdf`).expect(404);
    await other.client.get(`/api/itineraries/${id}/pdf`).expect(404);
    await admin.client.get(`/api/itineraries/${id}/pdf`).expect(404);
  });

  it('gives guests and other users the PDF of a public itinerary', async () => {
    const owner = await loggedInAs();
    const id = await itineraryOf(owner.client, { visibility: 'public' });
    const other = await loggedInAs();
    for (const res of [
      await binary(guest().get(`/api/itineraries/${id}/pdf`)),
      await binary(other.client.get(`/api/itineraries/${id}/pdf`)),
    ]) {
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
  });

  it('stops serving a public itinerary once a moderator hides it, but not to its owner', async () => {
    const owner = await loggedInAs();
    const id = await itineraryOf(owner.client, { visibility: 'public' });
    await itineraryModel.updateOne({ _id: id }, { isHidden: true });
    await guest().get(`/api/itineraries/${id}/pdf`).expect(404);
    await owner.client.get(`/api/itineraries/${id}/pdf`).expect(200);
  });

  it('turns back to a 404 when the owner makes it private again', async () => {
    const owner = await loggedInAs();
    const id = await itineraryOf(owner.client, { visibility: 'public' });
    await guest().get(`/api/itineraries/${id}/pdf`).expect(200);
    await owner.client
      .patch(`/api/itineraries/${id}`)
      .send({ visibility: 'private' })
      .expect(200);
    await guest().get(`/api/itineraries/${id}/pdf`).expect(404);
  });

  it('answers 404 for an unknown itinerary and for a malformed id', async () => {
    const owner = await loggedInAs();
    await owner.client
      .get(`/api/itineraries/${new Types.ObjectId().toString()}/pdf`)
      .expect(404);
    await owner.client.get('/api/itineraries/not-an-id/pdf').expect(404);
  });

  it('rejects a malformed currency code', async () => {
    const owner = await loggedInAs();
    const id = await itineraryOf(owner.client, { visibility: 'public' });
    await owner.client
      .get(`/api/itineraries/${id}/pdf?currency=US`)
      .expect(400);
    await guest().get(`/api/itineraries/${id}/pdf?currency=US`).expect(400);
  });
});

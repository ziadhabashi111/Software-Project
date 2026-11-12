import {
  Body,
  Controller,
  INestApplication,
  Module,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsEmail } from 'class-validator';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { HealthModule } from '../src/health/health.module';

class ProbeDto {
  @IsEmail()
  email!: string;
}

@Controller('probe')
class ProbeController {
  @Post()
  create(@Body() dto: ProbeDto): ProbeDto {
    return dto;
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('HTTP setup (e2e, no database)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule, ProbeModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns ok', async () => {
    const res = await request(server()).get('/api/health').expect(200);
    expect((res.body as { status: string }).status).toBe('ok');
  });

  it('unknown routes use the common error shape', async () => {
    const res = await request(server()).get('/api/nope').expect(404);
    expect(res.body).toEqual(
      expect.objectContaining({ statusCode: 404, path: '/api/nope' }),
    );
  });

  it('rejects invalid bodies and unknown fields (backend validation)', async () => {
    await request(server())
      .post('/api/probe')
      .send({ email: 'not-an-email' })
      .expect(400);
    await request(server())
      .post('/api/probe')
      .send({ email: 'a@b.com', isAdmin: true })
      .expect(400);
    await request(server())
      .post('/api/probe')
      .send({ email: 'a@b.com' })
      .expect(201);
  });
});

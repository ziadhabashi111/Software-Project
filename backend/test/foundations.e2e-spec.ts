import {
  Body,
  Controller,
  Get,
  INestApplication,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { IsEmail } from 'class-validator';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { CurrentUser } from '../src/auth/decorators/current-user.decorator';
import { Public } from '../src/auth/decorators/public.decorator';
import { Roles } from '../src/auth/decorators/roles.decorator';
import { AuthModule } from '../src/auth/auth.module';
import { Role } from '../src/auth/auth.types';
import type { AuthUser } from '../src/auth/auth.types';
import { TokenService } from '../src/auth/token.service';
import {
  PaginationQueryDto,
  toPage,
} from '../src/common/pagination/pagination';

class SignupDto {
  @IsEmail()
  email!: string;
}

@Controller('probe')
class ProbeController {
  @Public()
  @Get('open')
  open(@CurrentUser() user?: AuthUser): { who: string } {
    return { who: user?.id ?? 'guest' };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Roles(Role.ADMIN)
  @Get('admin')
  admin(): { ok: boolean } {
    return { ok: true };
  }

  @Public()
  @Get('list')
  list(@Query() query: PaginationQueryDto) {
    return toPage(['a'], 31, query);
  }

  @Public()
  @Post('signup')
  signup(@Body() dto: SignupDto): SignupDto {
    return dto;
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('Shared foundations (e2e, no database)', () => {
  let app: INestApplication;
  let tokens: TokenService;
  const server = () => app.getHttpServer() as Parameters<typeof request>[0];
  const cookieFor = (user: AuthUser) =>
    `access_token=${tokens.signAccessToken(user)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({ JWT_SECRET: 'an-e2e-secret-with-more-than-16-chars' }),
          ],
        }),
        AuthModule,
        ProbeModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    tokens = moduleRef.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('denies protected routes by default with the common error shape', async () => {
    const res = await request(server()).get('/api/probe/me').expect(401);
    expect(res.body).toEqual(
      expect.objectContaining({ statusCode: 401, path: '/api/probe/me' }),
    );
  });

  it('lets a logged-in user reach a protected route and sees who they are', async () => {
    const user = { id: 'user-1', role: Role.USER };
    const res = await request(server())
      .get('/api/probe/me')
      .set('Cookie', cookieFor(user))
      .expect(200);
    expect(res.body).toEqual(user);
  });

  it('keeps @Public routes open for guests and identifies logged-in users', async () => {
    const guest = await request(server()).get('/api/probe/open').expect(200);
    expect(guest.body).toEqual({ who: 'guest' });
    const known = await request(server())
      .get('/api/probe/open')
      .set('Cookie', cookieFor({ id: 'user-1', role: Role.USER }))
      .expect(200);
    expect(known.body).toEqual({ who: 'user-1' });
  });

  it('enforces @Roles: 403 for the wrong role, 200 for the right one', async () => {
    await request(server())
      .get('/api/probe/admin')
      .set('Cookie', cookieFor({ id: 'user-1', role: Role.USER }))
      .expect(403);
    await request(server())
      .get('/api/probe/admin')
      .set('Cookie', cookieFor({ id: 'admin-1', role: Role.ADMIN }))
      .expect(200);
  });

  it('paginates with page size 10 by default and validates the query', async () => {
    const res = await request(server()).get('/api/probe/list').expect(200);
    expect(res.body).toEqual({ items: ['a'], total: 31, page: 1, limit: 10 });
    await request(server()).get('/api/probe/list?page=0').expect(400);
    await request(server()).get('/api/probe/list?limit=500').expect(400);
  });

  it('returns field-level validation errors', async () => {
    const res = await request(server())
      .post('/api/probe/signup')
      .send({ email: 'nope' })
      .expect(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        message: 'Validation failed',
        errors: [{ field: 'email', messages: ['email must be an email'] }],
      }),
    );
  });
});

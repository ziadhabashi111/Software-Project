import {
  Controller,
  Get,
  INestApplication,
  Module,
  ModuleMetadata,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import { configureApp } from '../../src/app.setup';
import { AuthApiModule } from '../../src/auth/auth-api.module';
import { AuthModule } from '../../src/auth/auth.module';
import { SessionModule } from '../../src/auth/sessions/session.module';
import { UsersModule } from '../../src/users/users.module';

/** A protected route outside the auth module, to test route protection. */
@Controller('probe')
class ProbeController {
  @Get('secured')
  secured(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

export interface TestApp {
  app: INestApplication;
  moduleRef: TestingModule;
  server: Parameters<typeof import('supertest')>[0];
  close(): Promise<void>;
}

/**
 * Boots the real application modules against a real MongoDB running in
 * memory (no Atlas, no mocks). The first run downloads the MongoDB binary.
 */
export async function createTestApp(
  options: {
    extraModules?: NonNullable<ModuleMetadata['imports']>;
    /** Start a one-node replica set so MongoDB transactions work. */
    replSet?: boolean;
  } = {},
): Promise<TestApp> {
  // Generous launch limit: the first start on Windows is slow while the fresh
  // mongod binary is scanned.
  const mongo = options.replSet
    ? await MongoMemoryReplSet.create({
        replSet: { count: 1, storageEngine: 'wiredTiger' },
        instanceOpts: [{ launchTimeout: 120_000 }],
      })
    : await MongoMemoryServer.create({
        instance: { launchTimeout: 120_000 },
      });
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            JWT_SECRET: 'an-e2e-secret-with-more-than-16-chars',
            JWT_EXPIRES_IN: '15m',
            JWT_REFRESH_EXPIRES_IN: '7d',
            // supertest talks plain http, which never sends Secure cookies.
            COOKIE_SECURE: 'false',
          }),
        ],
      }),
      MongooseModule.forRoot(mongo.getUri()),
      AuthModule,
      SessionModule,
      UsersModule,
      AuthApiModule,
      ProbeModule,
      ...(options.extraModules ?? []),
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return {
    app,
    moduleRef,
    server: app.getHttpServer() as TestApp['server'],
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}

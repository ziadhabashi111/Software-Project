import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { originCheck } from './common/security/origin-check';
import {
  RateLimiter,
  RouteRateLimit,
  routeRateLimits,
} from './common/security/rate-limit';
import { securityHeaders } from './common/security/security-headers';
import { buildValidationException } from './common/validation/validation-errors';
import { corsOrigin } from './config/cors';

/**
 * Shared HTTP setup. Used by main.ts and by the e2e tests so tests run
 * against the same pipes, filters and prefix as production.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const env = config.get<string>('NODE_ENV');
  const frontend = corsOrigin(config);

  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  // Behind a proxy (deployment), req.ip and Secure cookies need the real client.
  if (config.get<string>('TRUST_PROXY') === 'true')
    express.set('trust proxy', 1);

  app.setGlobalPrefix('api');
  app.use(securityHeaders({ production: env === 'production' }));
  app.use(originCheck(frontend));
  // The e2e suites log in hundreds of times from one address.
  if (env !== 'test') app.use(routeRateLimits(AUTH_AND_UPLOAD_LIMITS()));
  app.use(cookieParser());

  // Backend validation is mandatory: strip unknown fields and reject extras.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: buildValidationException,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: frontend,
    credentials: true, // httpOnly auth cookies
  });
}

const MINUTE = 60_000;

/** Per client IP and minute: bcrypt-heavy auth routes and disk-filling uploads. */
function AUTH_AND_UPLOAD_LIMITS(): RouteRateLimit[] {
  const uploads = new RateLimiter(20, MINUTE);
  return [
    {
      method: 'POST',
      path: /^\/api\/auth\/login$/,
      name: 'login',
      limiter: new RateLimiter(10, MINUTE),
    },
    {
      method: 'POST',
      path: /^\/api\/auth\/register$/,
      name: 'register',
      limiter: new RateLimiter(5, MINUTE),
    },
    {
      method: 'POST',
      path: /^\/api\/auth\/refresh$/,
      name: 'refresh',
      limiter: new RateLimiter(30, MINUTE),
    },
    {
      method: 'PATCH',
      path: /^\/api\/auth\/change-password$/,
      name: 'change-password',
      limiter: new RateLimiter(5, MINUTE),
    },
    {
      method: 'POST',
      path: /^\/api\/(uploads\/images|(posts|hotels|activities)\/[^/]+\/images)$/,
      name: 'uploads',
      limiter: uploads,
    },
  ];
}

/** The OpenAPI document of every controller (Milestone 1 is evaluated through it). */
export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Travel Planning and Booking Platform API')
    .setDescription(
      'Milestone 1 backend. Reference requirement IDs (e.g. FLT-22, HTL-16, PAY-01) in each endpoint description.',
    )
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('api/docs', app, buildSwaggerDocument(app));
}

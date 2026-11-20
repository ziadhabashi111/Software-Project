import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { buildValidationException } from './common/validation/validation-errors';
import { corsOrigin } from './config/cors';

/**
 * Shared HTTP setup. Used by main.ts and by the e2e tests so tests run
 * against the same pipes, filters and prefix as production.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
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
    origin: corsOrigin(app.get(ConfigService)),
    credentials: true, // httpOnly auth cookies
  });
}

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Travel Planning and Booking Platform API')
    .setDescription(
      'Milestone 1 backend. Reference requirement IDs (e.g. FLT-22, HTL-16, PAY-01) in each endpoint description.',
    )
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
}

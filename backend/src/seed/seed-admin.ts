import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AdminSeeder } from '../users/admin-seeder.service';

/** `npm run seed:admin`: creates the administrator from ADMIN_EMAIL / ADMIN_PASSWORD (ACC-18). */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const result = await app.get(AdminSeeder).seedFromEnv();
    console.log(
      result === 'created'
        ? 'Administrator created.'
        : 'Administrator already exists, nothing changed.',
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

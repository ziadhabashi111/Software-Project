import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { REFERENCE_DATA_DIR } from './reference-data.parser';
import { ReferenceDataSeeder } from './reference-data.seeder';

/**
 * `npm run seed` (GEN-12): loads countries, cities, airports (with IANA time
 * zones), attractions and the supported currencies from
 * `docs/requirements/reference-data/`. Safe to run any number of times.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const counts = await app.get(ReferenceDataSeeder).seedFromFiles();
    console.log(`Reference data seeded from ${REFERENCE_DATA_DIR}:`);
    console.table(counts);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

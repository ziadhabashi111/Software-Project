import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Every `*.dto.ts` under `src`, so a new DTO is checked without touching this test. */
function dtoFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return dtoFiles(path);
    return name.endsWith('.dto.ts') ? [path] : [];
  });
}

/**
 * Swagger names a schema after its class, so two DTO classes with the same
 * name collapse into one schema and one of the endpoints documents the wrong
 * request body (Milestone 1 is evaluated through Swagger UI).
 */
describe('DTO class names (Swagger schemas)', () => {
  it('are unique across the whole app', () => {
    const owners = new Map<string, string[]>();
    for (const file of dtoFiles(join(__dirname, '..', '..'))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/^export class (\w+)/gm)) {
        owners.set(match[1], [...(owners.get(match[1]) ?? []), file]);
      }
    }
    const clashes = [...owners.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([name, files]) => `${name}: ${files.join(', ')}`);
    expect(clashes).toEqual([]);
  });

  it('finds the DTOs it is meant to check', () => {
    // Guards the scan itself: an empty scan would make the test above pass for nothing.
    expect(dtoFiles(join(__dirname, '..', '..')).length).toBeGreaterThan(20);
  });
});

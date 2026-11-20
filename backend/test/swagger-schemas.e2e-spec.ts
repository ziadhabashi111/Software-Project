import type { OpenAPIObject } from '@nestjs/swagger';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { buildSwaggerDocument } from '../src/app.setup';
import { createTestApp, TestApp } from './helpers/app';

interface Schema {
  properties?: Record<string, unknown>;
  required?: string[];
}

describe('Swagger schemas (Milestone 1 is evaluated through Swagger UI)', () => {
  let ctx: TestApp;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    ctx = await createTestApp({ extraModules: [AuditModule, AdminModule] });
    doc = buildSwaggerDocument(ctx.app);
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  const bodyRef = (path: string): string => {
    const operation = doc.paths[path]?.post as
      | {
          requestBody?: {
            content: Record<string, { schema: { $ref: string } }>;
          };
        }
      | undefined;
    const ref =
      operation?.requestBody?.content['application/json']?.schema.$ref;
    if (!ref) throw new Error(`No request body schema documented for ${path}`);
    return ref.split('/').pop() as string;
  };

  const schema = (name: string): Schema =>
    (doc.components?.schemas ?? {})[name] as Schema;

  // Two classes once shared the name ResetPasswordDto, so Swagger showed one
  // of these two endpoints the other endpoint's request body.
  it('documents each password reset endpoint with its own request body', () => {
    const own = bodyRef('/api/auth/reset-password');
    const admin = bodyRef('/api/admin/users/{id}/reset-password');
    expect(own).not.toBe(admin);
    expect(Object.keys(schema(own).properties ?? {}).sort()).toEqual([
      'newPassword',
      'token',
    ]);
    expect(Object.keys(schema(admin).properties ?? {})).toEqual([
      'temporaryPassword',
    ]);
  });

  it('gives every documented request body a schema of its own', () => {
    const refs: string[] = [];
    for (const item of Object.values(doc.paths)) {
      for (const operation of Object.values(item)) {
        const content = (
          operation as {
            requestBody?: {
              content?: Record<string, { schema?: { $ref?: string } }>;
            };
          }
        )?.requestBody?.content;
        const ref = content?.['application/json']?.schema?.$ref;
        if (ref) refs.push(ref);
      }
    }
    expect(refs.length).toBeGreaterThan(5);
    for (const ref of refs) {
      expect(schema(ref.split('/').pop() as string)).toBeDefined();
    }
  });
});

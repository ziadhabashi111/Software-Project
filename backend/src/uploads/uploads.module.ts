import { mkdirSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { Module, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Upload, UploadSchema } from './upload.schema';
import { UploadsController } from './uploads.controller';
import { UPLOADS_ROUTE, UploadsService } from './uploads.service';

/**
 * Owner: Ahmed Ismail
 * Requirements: GEN-08 (used by FLT-01, HTL-01, ITN-12, BLG-10)
 *
 * The shared image-upload helper. Import UploadsModule and inject
 * `UploadsService`; see `docs/api/uploads.md` for usage. Stored files are
 * served read-only at `/uploads/<name>` (outside the `/api` prefix), and each
 * file's uploader is recorded in the `uploads` collection.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Upload.name, schema: UploadSchema }]),
  ],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule implements OnModuleInit {
  constructor(
    private readonly uploads: UploadsService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  onModuleInit(): void {
    const adapter = this.adapterHost.httpAdapter;
    // No HTTP server (e.g. the seed scripts) or not the Express platform.
    if (!(adapter instanceof ExpressAdapter)) return;
    mkdirSync(this.uploads.directory, { recursive: true });
    // Nest's own Express static serving, so `express` need not be imported.
    adapter.useStaticAssets(this.uploads.directory, {
      prefix: UPLOADS_ROUTE,
      dotfiles: 'deny',
      index: false,
      fallthrough: true,
      setHeaders: (res: ServerResponse) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=86400');
      },
    });
  }
}

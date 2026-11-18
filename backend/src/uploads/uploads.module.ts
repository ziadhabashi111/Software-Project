import { mkdirSync } from 'node:fs';
import { Module, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import express from 'express';
import { UploadsController } from './uploads.controller';
import { UPLOADS_ROUTE, UploadsService } from './uploads.service';

/**
 * Owner: Ahmed Ismail
 * Requirements: GEN-08 (used by FLT-01, HTL-01, ITN-12, BLG-10)
 *
 * The shared image-upload helper. Import UploadsModule and inject
 * `UploadsService`; see `docs/api/uploads.md` for usage. Stored files are
 * served read-only at `/uploads/<name>` (outside the `/api` prefix).
 */
@Module({
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
    if (!adapter) return; // no HTTP server (e.g. the seed scripts)
    mkdirSync(this.uploads.directory, { recursive: true });
    adapter.use(
      UPLOADS_ROUTE,
      express.static(this.uploads.directory, {
        dotfiles: 'deny',
        index: false,
        fallthrough: true,
        setHeaders: (res) => {
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Cache-Control', 'public, max-age=86400');
        },
      }),
    );
  }
}

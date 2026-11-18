import {
  applyDecorators,
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { catchError, Observable, throwError } from 'rxjs';
import { fieldError } from '../common/validation/validation-errors';
import { MAX_FILES_PER_REQUEST, MAX_IMAGE_BYTES } from './image-rules';

/** Turns Multer's terse errors ("File too large") into clear field errors. */
@Injectable()
export class UploadErrorsInterceptor implements NestInterceptor {
  constructor(
    private readonly field: string,
    private readonly maxFiles: number,
  ) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(
        catchError((error: unknown) => throwError(() => this.translate(error))),
      );
  }

  private translate(error: unknown): unknown {
    if (error instanceof PayloadTooLargeException) {
      return fieldError(this.field, 'Each image must be 5 MB or smaller');
    }
    if (error instanceof BadRequestException) {
      const message = error.message;
      if (message === 'Too many files' || message === 'Unexpected field') {
        return fieldError(
          this.field,
          `Send at most ${this.maxFiles} image${this.maxFiles === 1 ? '' : 's'} in the "${this.field}" field`,
        );
      }
    }
    return error;
  }
}

/**
 * Accepts up to `maxFiles` images in the multipart field `field`, kept in
 * memory (never written before validation) and capped at 5 MB each. Read them
 * with `@UploadedFiles()` and pass them to `UploadsService.saveImages`.
 *
 * @example
 *   @Post(':id/images')
 *   @ImageUpload()
 *   addImages(@UploadedFiles() files: Express.Multer.File[]) { ... }
 */
export function ImageUpload(
  field = 'images',
  maxFiles: number = MAX_FILES_PER_REQUEST,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    UseInterceptors(
      new UploadErrorsInterceptor(field, maxFiles),
      FilesInterceptor(field, maxFiles, {
        limits: { fileSize: MAX_IMAGE_BYTES, files: maxFiles },
      }),
    ),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: [field],
        properties: {
          [field]: {
            type: 'array',
            maxItems: maxFiles,
            items: { type: 'string', format: 'binary' },
            description: `JPG or PNG, up to 5 MB each, at most ${maxFiles}`,
          },
        },
      },
    }),
  );
}

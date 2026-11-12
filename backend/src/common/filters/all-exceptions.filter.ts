import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/**
 * One error shape for the whole API:
 * { statusCode, error, message, path, timestamp }
 * Unexpected errors never leak internals to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, error, message } = this.normalize(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseBody = {
      statusCode,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(statusCode).json(body);
  }

  private normalize(exception: unknown): {
    statusCode: number;
    error: string;
    message: string | string[];
  } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        return {
          statusCode,
          error: HttpStatus[statusCode] ?? 'Error',
          message: res,
        };
      }
      const obj = res as { error?: string; message?: string | string[] };
      return {
        statusCode,
        error: obj.error ?? HttpStatus[statusCode] ?? 'Error',
        message: obj.message ?? exception.message,
      };
    }

    // MongoDB duplicate key (e.g. unique email) -> 409 instead of a raw 500
    if (
      typeof exception === 'object' &&
      exception !== null &&
      (exception as { code?: number }).code === 11000
    ) {
      return {
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'A record with the same unique value already exists',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Something went wrong',
    };
  }
}

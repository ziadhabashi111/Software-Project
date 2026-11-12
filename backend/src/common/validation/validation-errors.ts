import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

export interface FieldError {
  field: string;
  messages: string[];
}

function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  const result: FieldError[] = [];
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      result.push({ field, messages: Object.values(error.constraints) });
    }
    if (error.children?.length) {
      result.push(...flatten(error.children, field));
    }
  }
  return result;
}

/** Field-level validation errors for the forms (GEN-02). */
export function buildValidationException(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: 'Validation failed',
    errors: flatten(errors),
  });
}

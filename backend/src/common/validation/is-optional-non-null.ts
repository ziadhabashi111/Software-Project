import { applyDecorators } from '@nestjs/common';
import { IsDefined, ValidateIf } from 'class-validator';

/**
 * For PATCH bodies (GEN-13, GEN-02): the field may be left out, but `null`
 * is rejected with a field error. `@IsOptional()` skips every check for
 * both `undefined` and `null`, so a null would reach the database (or make
 * Mongoose throw a 500) for fields that cannot be empty.
 *
 * Use `@IsOptional()` only for fields where `null` means "clear it".
 */
export function IsOptionalNonNull(): PropertyDecorator {
  return applyDecorators(
    ValidateIf((_object: object, value: unknown) => value !== undefined),
    IsDefined({ message: '$property cannot be empty' }),
  );
}

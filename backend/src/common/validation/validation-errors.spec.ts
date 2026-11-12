import { IsEmail, MinLength, ValidateNested, validate } from 'class-validator';
import { plainToInstance, Type } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import { buildValidationException, fieldError } from './validation-errors';

class AddressDto {
  @MinLength(2)
  city!: string;
}

class SignupDto {
  @IsEmail()
  email!: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

describe('fieldError (GEN-02)', () => {
  it('builds a single inline error for a field, 400 by default', () => {
    const exception = fieldError(
      'currentPassword',
      'Current password is incorrect',
    );
    expect(exception.getStatus()).toBe(400);
    expect(exception.getResponse()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      errors: [
        {
          field: 'currentPassword',
          messages: ['Current password is incorrect'],
        },
      ],
    });
  });

  it('can answer 409 for a conflict such as a duplicate email', () => {
    const exception = fieldError('email', 'Email is already registered', 409);
    expect(exception.getStatus()).toBe(409);
    expect(exception.getResponse()).toEqual(
      expect.objectContaining({ statusCode: 409, error: 'Conflict' }),
    );
  });
});

describe('buildValidationException (GEN-02)', () => {
  it('returns a 400 with one entry per invalid field', async () => {
    const dto = plainToInstance(SignupDto, {
      email: 'nope',
      address: { city: 'x' },
    });
    const exception = buildValidationException(await validate(dto));

    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getStatus()).toBe(400);
    const body = exception.getResponse() as {
      message: string;
      errors: { field: string; messages: string[] }[];
    };
    expect(body.message).toBe('Validation failed');
    expect(body.errors).toEqual([
      { field: 'email', messages: ['email must be an email'] },
      {
        field: 'address.city',
        messages: ['city must be longer than or equal to 2 characters'],
      },
    ]);
  });
});

import { IsEmail, MinLength, ValidateNested, validate } from 'class-validator';
import { plainToInstance, Type } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import { buildValidationException } from './validation-errors';

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

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateActivityDto } from './create-activity.dto';

function invalidFields(body: Record<string, unknown>): string[] {
  const dto = plainToInstance(CreateActivityDto, body);
  return validateSync(dto).map((error) => error.property);
}

describe('CreateActivityDto: a cost keeps its own currency (ITN-10, ITN-18)', () => {
  it('rejects a cost without a currency', () => {
    expect(invalidFields({ name: 'Museum', cost: 10 })).toEqual(['currency']);
    expect(invalidFields({ name: 'Museum', cost: 0 })).toEqual(['currency']);
  });

  it('accepts a cost with a currency, and normalises the code', () => {
    expect(
      invalidFields({ name: 'Museum', cost: 10, currency: 'egp' }),
    ).toEqual([]);
    const dto = plainToInstance(CreateActivityDto, {
      name: 'Museum',
      cost: 10,
      currency: 'egp',
    });
    expect(dto.currency).toBe('EGP');
  });

  it('needs no currency when there is no cost', () => {
    expect(invalidFields({ name: 'Free walk' })).toEqual([]);
  });

  it('still rejects a malformed currency', () => {
    expect(
      invalidFields({ name: 'Museum', cost: 10, currency: 'dollars' }),
    ).toEqual(['currency']);
    expect(invalidFields({ name: 'Museum', currency: 'dollars' })).toEqual([
      'currency',
    ]);
  });
});

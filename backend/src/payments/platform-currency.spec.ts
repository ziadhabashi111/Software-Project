import { PLATFORM_CURRENCY } from './platform-currency';

describe('PLATFORM_CURRENCY (PAY-04)', () => {
  it('is a three-letter uppercase currency code', () => {
    expect(PLATFORM_CURRENCY).toMatch(/^[A-Z]{3}$/);
  });

  it('is USD', () => {
    expect(PLATFORM_CURRENCY).toBe('USD');
  });
});

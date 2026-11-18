import { HttpException } from '@nestjs/common';
import { assertBaggage } from './baggage-rules';

function errorField(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    const body = (error as HttpException).getResponse() as {
      errors?: { field: string }[];
    };
    return body.errors?.[0]?.field;
  }
  return undefined;
}

const POLICY = { extraBagPrice: 30, maxExtraBags: 2 };

describe('assertBaggage (FLT-19, FLT-08)', () => {
  it('no baggage policy allows no extra bags', () => {
    expect(errorField(() => assertBaggage(0, 1, 20, undefined, 23))).toBe(
      'passengers.0.extraBags',
    );
  });

  it('allows no extra bags without a policy', () => {
    expect(() => assertBaggage(0, 0, undefined, undefined, 23)).not.toThrow();
  });

  it('rejects more bags than the airline maximum', () => {
    expect(errorField(() => assertBaggage(1, 3, 20, POLICY, 23))).toBe(
      'passengers.1.extraBags',
    );
  });

  it('needs the weight when extra bags are added', () => {
    expect(errorField(() => assertBaggage(0, 1, undefined, POLICY, 23))).toBe(
      'passengers.0.extraBagWeightKg',
    );
  });

  it("rejects a bag heavier than the cabin's allowance", () => {
    expect(errorField(() => assertBaggage(0, 1, 24, POLICY, 23))).toBe(
      'passengers.0.extraBagWeightKg',
    );
  });

  it('accepts bags within the limits', () => {
    expect(() => assertBaggage(0, 2, 23, POLICY, 23)).not.toThrow();
  });
});

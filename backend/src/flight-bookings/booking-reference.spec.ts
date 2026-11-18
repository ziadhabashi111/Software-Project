import {
  isDuplicateReference,
  newFlightBookingReference,
} from './booking-reference';

describe('flight booking reference (FLT-23)', () => {
  it('looks like FB- plus 8 unambiguous characters', () => {
    for (let i = 0; i < 200; i += 1) {
      const reference = newFlightBookingReference();
      expect(reference).toMatch(/^FB-[A-HJ-NP-Z2-9]{8}$/);
      expect(reference.slice(3)).not.toMatch(/[01OI]/);
    }
  });

  it('recognises a duplicate reference error only', () => {
    expect(
      isDuplicateReference({ code: 11000, keyPattern: { reference: 1 } }),
    ).toBe(true);
    expect(isDuplicateReference({ code: 11000, keyPattern: { user: 1 } })).toBe(
      false,
    );
    expect(isDuplicateReference(new Error('boom'))).toBe(false);
    expect(isDuplicateReference(null)).toBe(false);
  });
});

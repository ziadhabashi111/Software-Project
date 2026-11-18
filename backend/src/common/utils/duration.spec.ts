import { parseDurationMs } from './duration';

describe('parseDurationMs', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['1h', 3_600_000],
    ['7d', 604_800_000],
  ])('parses %s', (input, expected) => {
    expect(parseDurationMs(input)).toBe(expected);
  });

  it.each(['', '15', 'm', '1x', '-5m', '1.5h', '15 m'])(
    'rejects %p',
    (input) => {
      expect(() => parseDurationMs(input)).toThrow(/duration/i);
    },
  );
});

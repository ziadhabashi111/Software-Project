import { CabinClass } from './flight-status';
import {
  isSeatInLayout,
  seatLabels,
  seatRows,
  seatsPerRowOf,
} from './seat-layout';

describe('seat layout (FLT-28)', () => {
  it('defaults to 6 seats per row in Economy and Premium Economy, 4 in Business and First', () => {
    expect(seatsPerRowOf({ cabinClass: CabinClass.ECONOMY })).toBe(6);
    expect(seatsPerRowOf({ cabinClass: CabinClass.PREMIUM_ECONOMY })).toBe(6);
    expect(seatsPerRowOf({ cabinClass: CabinClass.BUSINESS })).toBe(4);
    expect(seatsPerRowOf({ cabinClass: CabinClass.FIRST })).toBe(4);
    expect(
      seatsPerRowOf({ cabinClass: CabinClass.ECONOMY, seatsPerRow: 3 }),
    ).toBe(3);
  });

  it('labels rows from 1 and letters from A, with a partial last row', () => {
    expect(seatLabels(10, 6)).toEqual([
      '1A',
      '1B',
      '1C',
      '1D',
      '1E',
      '1F',
      '2A',
      '2B',
      '2C',
      '2D',
    ]);
    expect(seatRows(10, 6)).toEqual([
      { row: 1, seats: ['1A', '1B', '1C', '1D', '1E', '1F'] },
      { row: 2, seats: ['2A', '2B', '2C', '2D'] },
    ]);
  });

  it('knows which labels exist in a layout, ignoring case', () => {
    expect(isSeatInLayout('2D', 10, 6)).toBe(true);
    expect(isSeatInLayout('2d', 10, 6)).toBe(true);
    expect(isSeatInLayout('2E', 10, 6)).toBe(false);
    expect(isSeatInLayout('1G', 10, 6)).toBe(false);
    expect(isSeatInLayout('0A', 10, 6)).toBe(false);
    expect(isSeatInLayout('A1', 10, 6)).toBe(false);
  });
});

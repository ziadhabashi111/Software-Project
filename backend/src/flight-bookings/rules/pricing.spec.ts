import { PassengerType } from '../../flights/passenger-rules';
import { priceBooking, roundMoney } from './pricing';

describe('priceBooking (FLT-12b, FLT-19, PAY-04)', () => {
  it('prices fares, the infant share and extra bags on every segment', () => {
    const result = priceBooking(
      [
        { farePerSeat: 100, extraBagPrice: 30 },
        { farePerSeat: 80, extraBagPrice: 25 },
      ],
      [
        { type: PassengerType.ADULT, extraBags: 1 },
        { type: PassengerType.CHILD, extraBags: 0 },
        { type: PassengerType.INFANT, extraBags: 0 },
      ],
    );
    expect(result.passengers).toEqual([
      { fare: 180, baggageFee: 55 },
      { fare: 180, baggageFee: 0 },
      { fare: 18, baggageFee: 0 },
    ]);
    expect(result.fares).toBe(378);
    expect(result.baggage).toBe(55);
    expect(result.total).toBe(433);
    expect(result.perSegment).toEqual([240, 193]);
  });

  it('rounds the infant fare to cents', () => {
    const result = priceBooking(
      [{ farePerSeat: 33.33, extraBagPrice: 0 }],
      [
        { type: PassengerType.ADULT, extraBags: 0 },
        { type: PassengerType.INFANT, extraBags: 0 },
      ],
    );
    expect(result.passengers[1].fare).toBe(3.33);
    expect(result.total).toBe(36.66);
  });

  it('rounds money to two decimals', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(10.005)).toBe(10.01);
  });
});

import {
  INFANT_FARE_SHARE,
  PassengerType,
} from '../../flights/passenger-rules';

/** Rounds to cents, avoiding binary errors such as 10.005 -> 10.00. */
export function roundMoney(n: number): number {
  const text = String(n);
  if (text.includes('e')) return Math.round(n * 100) / 100;
  return Math.round(Number(`${text}e2`)) / 100;
}

export interface BookingPriceBreakdown {
  passengers: { fare: number; baggageFee: number }[];
  fares: number;
  baggage: number;
  total: number;
  /** Fares + baggage of each segment, in segment order. */
  perSegment: number[];
}

/**
 * FLT-12b / FLT-19 / PAY-04: adults and children pay the cabin fare, infants
 * 10% of it; extra bags are paid on every segment (my call). All amounts in
 * the platform currency.
 */
export function priceBooking(
  segments: { farePerSeat: number; extraBagPrice: number }[],
  passengers: { type: PassengerType; extraBags: number }[],
): BookingPriceBreakdown {
  const perPassenger = passengers.map(() => ({ fare: 0, baggageFee: 0 }));
  const perSegment = segments.map((segment) => {
    let segmentTotal = 0;
    passengers.forEach((passenger, i) => {
      const fare =
        passenger.type === PassengerType.INFANT
          ? roundMoney(segment.farePerSeat * INFANT_FARE_SHARE)
          : segment.farePerSeat;
      const bags = roundMoney(passenger.extraBags * segment.extraBagPrice);
      perPassenger[i].fare = roundMoney(perPassenger[i].fare + fare);
      perPassenger[i].baggageFee = roundMoney(
        perPassenger[i].baggageFee + bags,
      );
      segmentTotal += fare + bags;
    });
    return roundMoney(segmentTotal);
  });

  const fares = roundMoney(perPassenger.reduce((sum, p) => sum + p.fare, 0));
  const baggage = roundMoney(
    perPassenger.reduce((sum, p) => sum + p.baggageFee, 0),
  );
  return {
    passengers: perPassenger,
    fares,
    baggage,
    total: roundMoney(fares + baggage),
    perSegment,
  };
}

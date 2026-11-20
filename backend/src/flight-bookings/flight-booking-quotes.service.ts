import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { fieldError } from '../common/validation/validation-errors';
import type { CabinClass } from '../flights/flight-status';
import type { PassengerType } from '../flights/passenger-rules';
import { Airline, AirlineDocument } from '../flights/schemas/airline.schema';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import { PLATFORM_CURRENCY } from '../payments/platform-currency';
import { BookingRequestDto, SegmentChoiceDto } from './dto/booking-request.dto';
import { FlightBookingViews, SegmentView } from './flight-booking-view';
import { assertBaggage } from './rules/baggage-rules';
import {
  assertBookable,
  assertReturnMatches,
  SegmentField,
} from './rules/itinerary-rules';
import { classifyPassengers } from './rules/passenger-rules';
import { BookingPriceBreakdown, priceBooking } from './rules/pricing';
import type { TripType } from './schemas/flight-booking.schema';

/** One validated segment with the cabin terms in force right now. */
export interface PreparedSegment {
  flight: FlightDocument;
  airline: AirlineDocument;
  cabinClass: CabinClass;
  farePerSeat: number;
  freeBags: number;
  maxBagWeightKg: number;
  extraBagPrice: number;
}

export interface PreparedPassenger {
  fullName: string;
  dateOfBirth: Date;
  documentNumber: string;
  type: PassengerType;
  extraBags: number;
  extraBagWeightKg?: number;
}

/** Everything a summary or a hold needs, validated (FLT-12, FLT-19). */
export interface PreparedBooking {
  tripType: TripType;
  segments: PreparedSegment[];
  passengers: PreparedPassenger[];
  /** Adults + children: seats taken on each segment. */
  seats: number;
  price: BookingPriceBreakdown;
  cancellationTiers: { daysBefore: number; refundPercent: number }[];
  baggagePolicy?: { extraBagPrice: number; maxExtraBags: number };
}

/** PAY-02: what the user accepts before paying. */
export interface BookingPolicies {
  cancellationTiers: { daysBefore: number; refundPercent: number }[];
  baggagePolicy: { extraBagPrice: number; maxExtraBags: number } | null;
}

export interface BookingQuoteView {
  tripType: TripType;
  segments: (SegmentView & {
    farePerSeat: number;
    freeBags: number;
    maxBagWeightKg: number;
    extraBagPrice: number;
  })[];
  passengers: {
    fullName: string;
    type: PassengerType;
    extraBags: number;
    extraBagWeightKg: number | null;
    fare: number;
    baggageFee: number;
  }[];
  seats: number;
  price: Omit<BookingPriceBreakdown, 'passengers'>;
  currency: string;
  policies: BookingPolicies;
}

/**
 * Loads and validates the chosen flights, passengers and baggage, and prices
 * the booking. The summary (FLT-21) returns this without storing anything;
 * the hold (FLT-22) re-checks it inside its transaction.
 */
@Injectable()
export class FlightBookingQuotesService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(Airline.name)
    private readonly airlines: Model<AirlineDocument>,
    private readonly views: FlightBookingViews,
  ) {}

  async prepare(
    dto: BookingRequestDto,
    now: Date = new Date(),
  ): Promise<PreparedBooking> {
    const outbound = await this.loadSegment(dto.outbound, 'outbound', now);
    const segments = [outbound];
    if (dto.return) {
      const ret = await this.loadSegment(dto.return, 'return', now);
      const airports = await this.views.airportsFor([
        outbound.flight.departureAirport,
        outbound.flight.arrivalAirport,
        ret.flight.departureAirport,
        ret.flight.arrivalAirport,
      ]);
      assertReturnMatches(
        {
          id: outbound.flight.id,
          departureAirport: outbound.flight.departureAirport,
          arrivalAirport: outbound.flight.arrivalAirport,
          arrivalUtc: outbound.flight.arrivalUtc,
        },
        {
          id: ret.flight.id,
          departureAirport: ret.flight.departureAirport,
          arrivalAirport: ret.flight.arrivalAirport,
          departureUtc: ret.flight.departureUtc,
        },
        (code) => airports.get(code)?.cityId,
      );
      segments.push(ret);
    }

    const passengers: PreparedPassenger[] = dto.passengers.map((p) => ({
      fullName: p.fullName,
      dateOfBirth: new Date(`${p.dateOfBirth}T00:00:00Z`),
      documentNumber: p.documentNumber,
      type: p.type,
      extraBags: p.extraBags ?? 0,
      ...(p.extraBagWeightKg !== undefined
        ? { extraBagWeightKg: p.extraBagWeightKg }
        : {}),
    }));
    const counts = classifyPassengers(
      passengers,
      outbound.flight.departureLocalDate,
      now,
    );
    passengers.forEach((p, i) => {
      for (const segment of segments) {
        assertBaggage(
          i,
          p.extraBags,
          p.extraBagWeightKg,
          segment.airline.baggagePolicy,
          segment.maxBagWeightKg,
        );
      }
    });

    const policy = outbound.airline.baggagePolicy;
    return {
      tripType: segments.length > 1 ? 'round-trip' : 'one-way',
      segments,
      passengers,
      seats: counts.adults + counts.children,
      price: priceBooking(segments, passengers),
      cancellationTiers: outbound.airline.cancellationPolicy.map((tier) => ({
        daysBefore: tier.daysBefore,
        refundPercent: tier.refundPercent,
      })),
      ...(policy
        ? {
            baggagePolicy: {
              extraBagPrice: policy.extraBagPrice,
              maxExtraBags: policy.maxExtraBags,
            },
          }
        : {}),
    };
  }

  /** FLT-21: the booking summary; nothing is stored and no seat is held. */
  async quote(dto: BookingRequestDto): Promise<BookingQuoteView> {
    const prepared = await this.prepare(dto);
    const airports = await this.views.airportsFor(
      prepared.segments.flatMap((s) => [
        s.flight.departureAirport,
        s.flight.arrivalAirport,
      ]),
    );
    return toQuoteView(prepared, (segment) =>
      this.views.segmentView(
        segment.flight,
        segment.airline,
        segment.cabinClass,
        airports,
      ),
    );
  }

  private async loadSegment(
    choice: SegmentChoiceDto,
    field: SegmentField,
    now: Date,
  ): Promise<PreparedSegment> {
    const flight = await this.flights.findById(
      new Types.ObjectId(choice.flightId),
    );
    if (!flight) throw fieldError(`${field}.flightId`, 'Flight not found');
    const airline = await this.airlines.findById(flight.airlineId);
    assertBookable(flight, airline, choice.cabinClass, field, now);
    const cabin = flight.cabins.find((c) => c.cabinClass === choice.cabinClass);
    // assertBookable guarantees both exist.
    const bookable = airline as AirlineDocument;
    return {
      flight,
      airline: bookable,
      cabinClass: choice.cabinClass,
      farePerSeat: cabin?.price ?? 0,
      freeBags: cabin?.freeBags ?? 0,
      maxBagWeightKg: cabin?.maxBagWeightKg ?? 0,
      extraBagPrice: bookable.baggagePolicy?.extraBagPrice ?? 0,
    };
  }
}

export function toQuoteView(
  prepared: PreparedBooking,
  segmentView: (segment: PreparedSegment) => SegmentView,
): BookingQuoteView {
  const { passengers: perPassenger, ...totals } = prepared.price;
  return {
    tripType: prepared.tripType,
    segments: prepared.segments.map((segment) => ({
      ...segmentView(segment),
      farePerSeat: segment.farePerSeat,
      freeBags: segment.freeBags,
      maxBagWeightKg: segment.maxBagWeightKg,
      extraBagPrice: segment.extraBagPrice,
    })),
    passengers: prepared.passengers.map((p, i) => ({
      fullName: p.fullName,
      type: p.type,
      extraBags: p.extraBags,
      extraBagWeightKg: p.extraBagWeightKg ?? null,
      fare: perPassenger[i].fare,
      baggageFee: perPassenger[i].baggageFee,
    })),
    seats: prepared.seats,
    price: totals,
    currency: PLATFORM_CURRENCY,
    policies: {
      cancellationTiers: prepared.cancellationTiers,
      baggagePolicy: prepared.baggagePolicy ?? null,
    },
  };
}

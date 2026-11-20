import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { BookingStatus } from '../common/booking-status/booking-status';
import { holdExpiresAt } from '../common/booking-status/hold';
import { PLATFORM_CURRENCY } from '../payments/platform-currency';
import { BookingRequestDto } from './dto/booking-request.dto';
import {
  FlightBookingQuotesService,
  PreparedBooking,
  PreparedSegment,
} from './flight-booking-quotes.service';
import { FlightBookingView, FlightBookingViews } from './flight-booking-view';
import { priceBooking } from './rules/pricing';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';
import { SeatInventory } from './seat-inventory';

/** FLT-22: how long seats stay held while the user pays (shared with hotels). */
export { HOLD_MINUTES } from '../common/booking-status/hold';

/**
 * Proceed to payment (FLT-22): validates like the summary, then holds the
 * seats of every segment and creates the Pending Payment booking in one
 * MongoDB transaction. Any segment without enough seats aborts the whole
 * transaction, so a round trip is all or nothing.
 */
@Injectable()
export class FlightBookingHoldsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    private readonly quotes: FlightBookingQuotesService,
    private readonly seats: SeatInventory,
    private readonly views: FlightBookingViews,
  ) {}

  async hold(
    user: AuthUser,
    dto: BookingRequestDto,
    now: Date = new Date(),
  ): Promise<FlightBookingView> {
    const prepared = await this.quotes.prepare(dto, now);
    const booking = await this.connection.transaction(async (session) => {
      const segments: PreparedSegment[] = [];
      for (const segment of prepared.segments) {
        const updated = await this.seats.hold(
          segment.flight._id,
          segment.cabinClass,
          prepared.seats,
          session,
          now,
        );
        if (!updated) throw seatsUnavailable(segment.flight.flightNumber);
        // The price at the moment the seats were held (FLT-05).
        const cabin = updated.cabins.find(
          (c) => c.cabinClass === segment.cabinClass,
        );
        segments.push({
          ...segment,
          flight: updated,
          farePerSeat: cabin?.price ?? segment.farePerSeat,
          freeBags: cabin?.freeBags ?? segment.freeBags,
          maxBagWeightKg: cabin?.maxBagWeightKg ?? segment.maxBagWeightKg,
        });
      }
      const [created] = await this.bookings.create(
        [toBookingDocument(user.id, { ...prepared, segments }, now)],
        { session },
      );
      return created;
    });
    return this.views.bookingView(booking);
  }
}

function toBookingDocument(
  userId: string,
  prepared: PreparedBooking,
  now: Date,
): Partial<FlightBooking> {
  const price = priceBooking(prepared.segments, prepared.passengers);
  return {
    user: new Types.ObjectId(userId),
    tripType: prepared.tripType,
    segments: prepared.segments.map((s) => ({
      flight: s.flight._id,
      airline: s.airline._id,
      cabinClass: s.cabinClass,
      farePerSeat: s.farePerSeat,
      freeBags: s.freeBags,
      maxBagWeightKg: s.maxBagWeightKg,
      extraBagPrice: s.extraBagPrice,
    })),
    passengers: prepared.passengers.map((p, i) => ({
      ...p,
      fare: price.passengers[i].fare,
      baggageFee: price.passengers[i].baggageFee,
    })),
    seats: prepared.seats,
    price: {
      fares: price.fares,
      baggage: price.baggage,
      total: price.total,
      perSegment: price.perSegment,
    },
    currency: PLATFORM_CURRENCY,
    cancellationTiers: prepared.cancellationTiers,
    ...(prepared.baggagePolicy
      ? { baggagePolicy: prepared.baggagePolicy }
      : {}),
    status: BookingStatus.PENDING_PAYMENT,
    holdExpiresAt: holdExpiresAt(now),
  };
}

function seatsUnavailable(flightNumber: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: `Not enough seats left on flight ${flightNumber} in this cabin. Choose another flight or cabin.`,
    code: 'SEATS_UNAVAILABLE',
  });
}

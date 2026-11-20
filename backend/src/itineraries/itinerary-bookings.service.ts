import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { fieldError } from '../common/validation/validation-errors';
import { MyFlightBookingsService } from '../flight-bookings/my-flight-bookings.service';
import { MyHotelReservationsService } from '../hotel-bookings/my-hotel-reservations.service';
import {
  budgetLines,
  describeFlight,
  describeHotel,
  isLinkable,
  LinkedBookingType,
} from './booking-links';
import type { BookingFacts } from './booking-links';
import type { LinkBookingDto } from './dto/link-booking.dto';
import { toLinkedBookingView } from './itinerary-booking-view';
import type { LinkedBookingView } from './itinerary-booking-view';
import { ItineraryRepository } from './itinerary.repository';
import { ItineraryBooking } from './schemas/itinerary-booking.schema';
import type { ItineraryDocument } from './schemas/itinerary.schema';

type Caller = Pick<AuthUser, 'id' | 'role'>;

const isDuplicateKey = (error: unknown): boolean =>
  (error as { code?: number }).code === 11000;

/**
 * ITN-27: the traveller links their own confirmed flight and hotel bookings
 * to the days of their itinerary, and those bookings feed the budget. Only the
 * link is stored here; everything about the booking is read from the booking
 * module (as its owner) each time, so a changed or cancelled booking is never
 * out of date and another user's booking can never be linked.
 */
@Injectable()
export class ItineraryBookingsService {
  constructor(
    @InjectModel(ItineraryBooking.name)
    private readonly links: Model<ItineraryBooking>,
    private readonly itineraries: ItineraryRepository,
    private readonly flights: MyFlightBookingsService,
    private readonly hotels: MyHotelReservationsService,
  ) {}

  async link(
    user: Caller,
    itineraryId: string,
    dto: LinkBookingDto,
  ): Promise<LinkedBookingView> {
    const itinerary = await this.itineraries.loadOwned(itineraryId, user);
    const dayIndex = itinerary.days.findIndex(
      (day) => day._id.toString() === dto.dayId,
    );
    if (dayIndex === -1) {
      throw fieldError('dayId', 'This itinerary has no such day');
    }
    // A booking that is not the user's, or does not exist, is the booking
    // module's own 404.
    const facts = await this.factsOf(user.id, dto.bookingType, dto.bookingId);
    if (!isLinkable(facts.status)) {
      throw fieldError(
        'bookingId',
        'Only a confirmed booking can be linked to an itinerary',
        409,
      );
    }
    try {
      const link = await this.links.create({
        itineraryId: itinerary._id,
        dayId: new Types.ObjectId(dto.dayId),
        bookingType: dto.bookingType,
        bookingId: new Types.ObjectId(dto.bookingId),
      });
      return toLinkedBookingView(link, facts, dayIndex + 1);
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw fieldError(
          'bookingId',
          'This booking is already linked to this itinerary',
          409,
        );
      }
      throw error;
    }
  }

  /** The itinerary's linked bookings by day, each with its details right now. */
  async list(user: Caller, itineraryId: string): Promise<LinkedBookingView[]> {
    const itinerary = await this.itineraries.loadOwned(itineraryId, user);
    const rows = await this.resolve(itinerary);
    return rows
      .map(({ link, facts, dayNumber }) =>
        toLinkedBookingView(link, facts, dayNumber),
      )
      .sort(
        (a, b) =>
          (a.dayNumber ?? Infinity) - (b.dayNumber ?? Infinity) ||
          a.title.localeCompare(b.title),
      );
  }

  /** Removes the link only; the booking itself is untouched. */
  async unlink(
    user: Caller,
    itineraryId: string,
    linkId: string,
  ): Promise<void> {
    const itinerary = await this.itineraries.loadOwned(itineraryId, user);
    const { deletedCount } = await this.links.deleteOne({
      _id: linkId,
      itineraryId: itinerary._id,
    });
    if (deletedCount !== 1) throw new NotFoundException('Link not found');
  }

  /**
   * The budget lines the itinerary's linked bookings add (see `budgetLines`).
   * Only for the owner's own budget: a public viewer never sees private
   * bookings, so the public summary does not call this.
   */
  async budgetLines(itinerary: ItineraryDocument) {
    const rows = await this.resolve(itinerary);
    return budgetLines(
      rows.map(({ link, facts }) => ({
        dayId: link.dayId.toString(),
        type: link.bookingType,
        facts,
      })),
    );
  }

  /** Each stored link with its booking's current facts; links whose booking is gone are left out. */
  private async resolve(itinerary: ItineraryDocument) {
    const stored = await this.links
      .find({ itineraryId: itinerary._id })
      .sort({ createdAt: 1 });
    if (stored.length === 0) return [];
    const ownerId = itinerary.owner.toString();
    const rows = await Promise.all(
      stored.map(async (link) => {
        try {
          const facts = await this.factsOf(
            ownerId,
            link.bookingType,
            link.bookingId.toString(),
          );
          const index = itinerary.days.findIndex((day) =>
            day._id.equals(link.dayId),
          );
          return { link, facts, dayNumber: index === -1 ? null : index + 1 };
        } catch (error) {
          if (error instanceof NotFoundException) return null;
          throw error;
        }
      }),
    );
    return rows.filter((row) => row !== null);
  }

  private async factsOf(
    userId: string,
    type: LinkedBookingType,
    bookingId: string,
  ): Promise<BookingFacts> {
    const owner: Caller = { id: userId, role: Role.USER };
    return type === LinkedBookingType.FLIGHT
      ? describeFlight(await this.flights.get(bookingId, owner))
      : describeHotel(await this.hotels.get(owner, bookingId));
  }
}

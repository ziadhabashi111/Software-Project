import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { BookingStatus } from '../common/booking-status/booking-status';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
import { assertCanAccess } from '../common/security/ownership';
import {
  BookingGroup,
  ListFlightBookingsDto,
} from './dto/list-flight-bookings.dto';
import { renderETicket } from './e-ticket/e-ticket.renderer';
import { FlightBookingExpiryService } from './flight-booking-expiry.service';
import { FlightBookingView, FlightBookingViews } from './flight-booking-view';
import { quoteUserRefund } from './rules/cancellation-rules';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';

/** FLT-25: a user's own flight bookings, grouped, and one booking's details. */
@Injectable()
export class MyFlightBookingsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    private readonly expiry: FlightBookingExpiryService,
    private readonly views: FlightBookingViews,
  ) {}

  async list(
    user: AuthUser,
    query: ListFlightBookingsDto,
    now: Date = new Date(),
  ): Promise<Paginated<FlightBookingView>> {
    const userId = new Types.ObjectId(user.id);
    // Holds that ran out move to Past now, not at the next sweep.
    const due = await this.bookings
      .find({
        user: userId,
        status: BookingStatus.PENDING_PAYMENT,
        holdExpiresAt: { $lte: now },
      })
      .select('_id')
      .lean();
    for (const { _id } of due) await this.expiry.expireOne(_id, now);

    const filter = groupFilter(userId, query.group, now);
    const [docs, total] = await Promise.all([
      this.bookings
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skipFor(query))
        .limit(query.limit),
      this.bookings.countDocuments(filter),
    ]);
    return toPage(await this.views.bookingViews(docs), total, query);
  }

  /**
   * Full details for the owner or an admin (another user gets 404). Includes
   * the refund preview while the booking can still be cancelled (FLT-26).
   */
  async get(
    id: string,
    user: AuthUser,
    now: Date = new Date(),
  ): Promise<FlightBookingView> {
    let doc = await this.bookings.findById(id);
    if (!doc) throw new NotFoundException('Booking not found');
    assertCanAccess(doc.user, user, { allowRoles: [Role.ADMIN] });

    if (
      doc.status === BookingStatus.PENDING_PAYMENT &&
      doc.holdExpiresAt &&
      doc.holdExpiresAt.getTime() <= now.getTime() &&
      (await this.expiry.expireOne(doc._id, now))
    ) {
      doc = (await this.bookings.findById(id)) ?? doc;
    }

    const view = await this.views.bookingView(doc);
    return { ...view, cancellation: cancellationPreview(doc, view, now) };
  }
  /** FLT-23: the e-ticket PDF of a Confirmed or Completed booking. */
  async eTicket(
    id: string,
    user: AuthUser,
  ): Promise<{ filename: string; pdf: Buffer }> {
    const view = await this.get(id, user);
    if (
      view.status !== BookingStatus.CONFIRMED &&
      view.status !== BookingStatus.COMPLETED
    ) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'The e-ticket is available once the booking is Confirmed',
        code: 'TICKET_NOT_AVAILABLE',
      });
    }
    return {
      filename: `${view.reference ?? view.id}.pdf`,
      pdf: await renderETicket(view),
    };
  }
}

function groupFilter(
  user: Types.ObjectId,
  group: BookingGroup,
  now: Date,
): QueryFilter<FlightBooking> {
  switch (group) {
    case 'past':
      return {
        user,
        status: { $in: [BookingStatus.COMPLETED, BookingStatus.EXPIRED] },
      };
    case 'cancelled':
      return { user, status: BookingStatus.CANCELLED };
    default:
      return {
        user,
        $or: [
          {
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt: { $gt: now },
          },
          { status: BookingStatus.CONFIRMED },
        ],
      };
  }
}

/** FLT-26: what cancelling now would refund, or null if it cannot be cancelled. */
export function cancellationPreview(
  doc: FlightBookingDocument,
  view: FlightBookingView,
  now: Date,
): FlightBookingView['cancellation'] {
  const outbound = view.segments[0];
  if (doc.status !== BookingStatus.CONFIRMED || !outbound) return null;
  const departure = new Date(outbound.departure.utc);
  if (departure.getTime() <= now.getTime()) return null;
  return quoteUserRefund(
    doc.price.total,
    doc.cancellationTiers,
    departure,
    now,
  );
}

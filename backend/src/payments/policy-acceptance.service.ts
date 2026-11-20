import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BookingPaymentGateway,
  BookingPoliciesView,
} from './booking-payment-gateway';
import type { BookingType } from './refund.service.interface';
import {
  PolicyAcceptance,
  PolicyAcceptanceDocument,
} from './schemas/policy-acceptance.schema';

/** PAY-02: policy acceptance, stored with a timestamp; payment needs it. */
@Injectable()
export class PolicyAcceptanceService {
  constructor(
    @InjectModel(PolicyAcceptance.name)
    private readonly acceptances: Model<PolicyAcceptanceDocument>,
    private readonly gateway: BookingPaymentGateway,
  ) {}

  /** Idempotent: accepting twice keeps the first timestamp. */
  async accept(
    type: BookingType,
    bookingId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<{
    bookingType: BookingType;
    bookingId: string;
    acceptedAt: Date;
  }> {
    // Proves the booking is the user's own and still waiting for payment.
    await this.gateway.payable(type, bookingId, userId);
    const doc = await this.acceptances.findOneAndUpdate(
      { bookingType: type, bookingId: new Types.ObjectId(bookingId) },
      {
        $setOnInsert: {
          userId: new Types.ObjectId(userId),
          acceptedAt: now,
        },
      },
      { upsert: true, new: true },
    );
    return { bookingType: type, bookingId, acceptedAt: doc.acceptedAt };
  }

  /** PAY-02: the policies plus whether (and when) the user accepted them. */
  async view(
    type: BookingType,
    bookingId: string,
    userId: string,
  ): Promise<BookingPoliciesView & { accepted: boolean; acceptedAt?: Date }> {
    const policies = await this.gateway.policies(type, bookingId, userId);
    const found = await this.acceptances.findOne({
      bookingType: type,
      bookingId: new Types.ObjectId(bookingId),
      userId: new Types.ObjectId(userId),
    });
    return {
      ...policies,
      accepted: !!found,
      ...(found ? { acceptedAt: found.acceptedAt } : {}),
    };
  }

  async assertAccepted(
    type: BookingType,
    bookingId: string,
    userId: string,
  ): Promise<void> {
    // A flight change is covered by the booking's acceptance (FLT-27).
    const target = await this.gateway.acceptanceTarget(type, bookingId);
    const found = await this.acceptances.exists({
      userId: new Types.ObjectId(userId),
      $or: [
        { bookingType: type, bookingId: new Types.ObjectId(bookingId) },
        {
          bookingType: target.type,
          bookingId: new Types.ObjectId(target.bookingId),
        },
      ],
    });
    if (!found) {
      throw new ConflictException({
        message: 'Accept the booking policies before paying',
        code: 'POLICIES_NOT_ACCEPTED',
      });
    }
  }
}

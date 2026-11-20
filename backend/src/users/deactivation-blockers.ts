import { Injectable } from '@nestjs/common';

/** Implemented by the flight and hotel booking modules (ACC-12). */
export interface DeactivationBlocker {
  /** True when the user has a Confirmed booking that has not happened yet. */
  hasUpcomingConfirmedBookings(userId: string): Promise<boolean>;
  /**
   * Ends the user's unpaid holds (Expired, inventory released, payment
   * cancelled). Called once the account is marked deactivated and before the
   * booking check, so a payment that lands afterwards is refunded instead of
   * confirming a booking on a deactivated account (ACC-12, GEN-11).
   */
  endPendingHolds?(userId: string): Promise<void>;
}

/**
 * A user cannot deactivate their account while they have upcoming Confirmed
 * bookings (ACC-12). The booking modules plug in here, so the users module
 * does not depend on them:
 *
 *   constructor(blockers: DeactivationBlockers) {}
 *   onModuleInit() { this.blockers.register(this); }
 */
@Injectable()
export class DeactivationBlockers {
  private readonly blockers: DeactivationBlocker[] = [];

  register(blocker: DeactivationBlocker): void {
    this.blockers.push(blocker);
  }

  /** Ends every module's unpaid holds of the user (see `endPendingHolds`). */
  async endPendingHolds(userId: string): Promise<void> {
    await Promise.all(
      this.blockers.map((blocker) =>
        blocker.endPendingHolds
          ? blocker.endPendingHolds(userId)
          : Promise.resolve(),
      ),
    );
  }

  async hasUpcomingBookings(userId: string): Promise<boolean> {
    const answers = await Promise.all(
      this.blockers.map((blocker) =>
        blocker.hasUpcomingConfirmedBookings(userId),
      ),
    );
    return answers.some(Boolean);
  }
}

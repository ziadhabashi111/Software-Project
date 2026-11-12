import { Injectable } from '@nestjs/common';

/** Implemented by the flight and hotel booking modules (ACC-12). */
export interface DeactivationBlocker {
  /** True when the user has a Confirmed booking that has not happened yet. */
  hasUpcomingConfirmedBookings(userId: string): Promise<boolean>;
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

  async hasUpcomingBookings(userId: string): Promise<boolean> {
    const answers = await Promise.all(
      this.blockers.map((blocker) =>
        blocker.hasUpcomingConfirmedBookings(userId),
      ),
    );
    return answers.some(Boolean);
  }
}

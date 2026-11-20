import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  NOTIFICATION_SERVICE,
  NotificationService,
} from '../notifications/notification.service.interface';
import {
  PAYMENT_SERVICE,
  PaymentService,
  PendingPaymentCancellation,
} from '../payments/payment.service.interface';
import {
  REFUND_SERVICE,
  RefundService,
} from '../payments/refund.service.interface';

/**
 * Finds Ziad's shared services by their tokens (docs/shared-services.md).
 *
 * Looked up when first needed rather than injected: the payments module will
 * import this module (webhook -> `confirmPaid`), so importing it back would
 * be a module cycle. Same pattern as hotel bookings. Until a service is
 * provided anywhere in the app, its getter returns `undefined`.
 */
@Injectable()
export class SharedServices {
  private readonly logger = new Logger(SharedServices.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  refunds(): RefundService | undefined {
    return this.find<RefundService>(REFUND_SERVICE);
  }

  /** In-app notification (GEN-01); a failure is logged, never thrown. */
  async notify(userId: string, type: string, message: string): Promise<void> {
    try {
      await this.find<NotificationService>(NOTIFICATION_SERVICE)?.notify(
        userId,
        type,
        message,
      );
    } catch (error) {
      this.logger.error(
        `Could not send ${type} to user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * PAY-01: an expired hold's PaymentIntent is cancelled; failures are logged.
   * `not_cancellable` means the user already paid: the webhook decides.
   */
  async cancelPendingPayment(
    bookingId: string,
  ): Promise<PendingPaymentCancellation> {
    try {
      const payments = this.find<PaymentService>(PAYMENT_SERVICE);
      if (!payments) return 'none';
      return (await payments.cancelPendingPayment('flight', bookingId)) ?? 'none';
    } catch (error) {
      this.logger.error(
        `Could not cancel the payment of flight booking ${bookingId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return 'error';
    }
  }

  private find<T>(token: symbol): T | undefined {
    try {
      return this.moduleRef.get<T>(token, { strict: false });
    } catch {
      return undefined;
    }
  }
}

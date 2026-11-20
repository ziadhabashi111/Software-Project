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
 * They are looked up when first needed rather than injected, because the
 * payments module will itself call this module (webhook -> confirm), and a
 * direct import both ways would be a module cycle. Until a service is
 * provided anywhere in the app, its getter returns `undefined`.
 */
@Injectable()
export class SharedServices {
  private readonly logger = new Logger(SharedServices.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  notifications(): NotificationService | undefined {
    return this.find<NotificationService>(NOTIFICATION_SERVICE);
  }

  payments(): PaymentService | undefined {
    return this.find<PaymentService>(PAYMENT_SERVICE);
  }

  refunds(): RefundService | undefined {
    return this.find<RefundService>(REFUND_SERVICE);
  }

  /** Sends an in-app notification; a failure is logged, never thrown (GEN-01). */
  async notify(userId: string, type: string, message: string): Promise<void> {
    try {
      await this.notifications()?.notify(userId, type, message);
    } catch (error) {
      this.logger.error(
        `Could not send ${type} to user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Cancels the open PaymentIntent of a run-out hold (PAY-01). Failures are
   * logged and answered `error`; `not_cancellable` means Stripe already took
   * the payment, so the webhook decides what happens to the hold.
   */
  async cancelPendingPayment(
    reservationId: string,
  ): Promise<PendingPaymentCancellation> {
    try {
      const payments = this.payments();
      if (!payments) return 'none';
      return await payments.cancelPendingPayment('hotel', reservationId);
    } catch (error) {
      this.logger.error(
        `Could not cancel the payment of hotel reservation ${reservationId}`,
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

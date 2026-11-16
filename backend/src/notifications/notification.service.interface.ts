/** Injection token for the notification service (GEN-01). */
export const NOTIFICATION_SERVICE = Symbol('NOTIFICATION_SERVICE');

/**
 * Sends an in-app notification to one user, e.g. booking confirmed,
 * booking cancelled, refund issued.
 */
export interface NotificationService {
  notify(userId: string, type: string, message: string): Promise<void>;
}

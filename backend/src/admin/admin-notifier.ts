export const ADMIN_NOTIFIER = Symbol('ADMIN_NOTIFIER');

export interface AdminNotification {
  /** Machine-readable kind, e.g. `PROVIDER_DEACTIVATED`. */
  type: string;
  message: string;
}

/**
 * In-app notifications for admin actions (ACC-15). Ziad's notifications module
 * provides this token (an adapter around `NotificationService`); until then
 * the admin module simply has nobody to tell and carries on.
 */
export interface AdminNotifier {
  notify(userIds: string[], notification: AdminNotification): Promise<void>;
}

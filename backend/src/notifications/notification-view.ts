import type { NotificationDocument } from './schemas/notification.schema';

/** What the API returns for a notification: no database internals. */
export interface NotificationView {
  id: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export function toNotificationView(
  doc: NotificationDocument,
): NotificationView {
  return {
    id: doc.id,
    type: doc.type,
    message: doc.message,
    read: doc.read,
    createdAt: doc.createdAt.toISOString(),
  };
}

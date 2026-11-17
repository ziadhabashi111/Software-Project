import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotificationService } from './notification.service.interface';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';

export interface NotificationPage {
  items: NotificationDocument[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class NotificationsService implements NotificationService {
  constructor(
    @InjectModel(Notification.name)
    private readonly model: Model<NotificationDocument>,
  ) {}

  /** Called by other modules (bookings, payments) through NOTIFICATION_SERVICE. */
  async notify(userId: string, type: string, message: string): Promise<void> {
    await this.model.create({
      userId: new Types.ObjectId(userId),
      type,
      message,
    });
  }

  /** One page of this user's notifications, newest first. */
  async findForUser(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<NotificationPage> {
    const filter = { userId: new Types.ObjectId(userId) };
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit };
  }

  countUnread(userId: string): Promise<number> {
    return this.model
      .countDocuments({ userId: new Types.ObjectId(userId), read: false })
      .exec();
  }

  /** Marks one notification read, only if it belongs to this user. */
  async markRead(userId: string, id: string): Promise<NotificationDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Notification not found');
    }
    const updated = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
        { read: true },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Notification not found');
    }
    return updated;
  }

  /** Marks all of this user's unread notifications read; returns how many. */
  async markAllRead(userId: string): Promise<number> {
    const result = await this.model
      .updateMany(
        { userId: new Types.ObjectId(userId), read: false },
        { read: true },
      )
      .exec();
    return result.modifiedCount;
  }
}

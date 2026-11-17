import { NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { NotificationsService } from './notifications.service';
import type { NotificationDocument } from './schemas/notification.schema';

/** A query object whose chained calls return itself and whose exec() resolves. */
function query<T>(result: T) {
  const q = {
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  q.sort.mockReturnValue(q);
  q.skip.mockReturnValue(q);
  q.limit.mockReturnValue(q);
  return q;
}

function setup() {
  const model = {
    create: jest.fn().mockResolvedValue({}),
    find: jest.fn(),
    countDocuments: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateMany: jest.fn(),
  };
  const service = new NotificationsService(
    model as unknown as Model<NotificationDocument>,
  );
  return { model, service };
}

describe('NotificationsService (GEN-01)', () => {
  const userId = new Types.ObjectId().toHexString();
  const otherId = new Types.ObjectId().toHexString();

  it('notify saves the type and message for the right user', async () => {
    const { model, service } = setup();
    await service.notify(userId, 'BOOKING_CONFIRMED', 'Flight confirmed');
    expect(model.create).toHaveBeenCalledWith({
      userId: new Types.ObjectId(userId),
      type: 'BOOKING_CONFIRMED',
      message: 'Flight confirmed',
    });
  });

  it('lists one page: page 3 of 10 skips 20, newest first', async () => {
    const { model, service } = setup();
    const q = query([]);
    model.find.mockReturnValue(q);
    model.countDocuments.mockReturnValue(query(45));

    const result = await service.findForUser(userId, 3, 10);

    expect(model.find).toHaveBeenCalledWith({
      userId: new Types.ObjectId(userId),
    });
    expect(q.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(q.skip).toHaveBeenCalledWith(20);
    expect(q.limit).toHaveBeenCalledWith(10);
    expect(result).toMatchObject({ total: 45, page: 3, limit: 10 });
  });

  it('counts only this user’s unread notifications', async () => {
    const { model, service } = setup();
    model.countDocuments.mockReturnValue(query(4));
    await expect(service.countUnread(userId)).resolves.toBe(4);
    expect(model.countDocuments).toHaveBeenCalledWith({
      userId: new Types.ObjectId(userId),
      read: false,
    });
  });

  describe('markRead ownership', () => {
    it('matches on both the notification id and the owner', async () => {
      const { model, service } = setup();
      const id = new Types.ObjectId().toHexString();
      model.findOneAndUpdate.mockReturnValue(query({ read: true }));

      await service.markRead(userId, id);

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
        { read: true },
        { new: true },
      );
    });

    it('returns 404 when the notification belongs to someone else', async () => {
      const { model, service } = setup();
      model.findOneAndUpdate.mockReturnValue(query(null));
      const id = new Types.ObjectId().toHexString();
      await expect(service.markRead(otherId, id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns 404 for a malformed id without touching the database', async () => {
      const { model, service } = setup();
      await expect(
        service.markRead(userId, 'not-an-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  it('markAllRead only touches this user’s unread ones and reports the count', async () => {
    const { model, service } = setup();
    model.updateMany.mockReturnValue(query({ modifiedCount: 3 }));
    await expect(service.markAllRead(userId)).resolves.toBe(3);
    expect(model.updateMany).toHaveBeenCalledWith(
      { userId: new Types.ObjectId(userId), read: false },
      { read: true },
    );
  });
});

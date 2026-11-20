import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, QueryFilter, Types } from 'mongoose';
import { AuditAction } from './audit-action';
import { AuditLog, AuditLogDocument } from './audit-log.schema';

export interface AuditLogEntry {
  actorId: string;
  action: AuditAction;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

/**
 * Every admin action that changes accounts, providers or content calls
 * `log()` (GEN-07). Errors are not swallowed: an action without its audit
 * record should fail loudly.
 */
@Injectable()
export class AuditLogService {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly model: Model<AuditLogDocument>,
  ) {}

  /**
   * Pass the action's `session` so the change and its record commit together.
   * Returns the record's id, so an action that cannot share a transaction
   * can write its record first and `discard` it if the action then fails.
   */
  async log(
    entry: AuditLogEntry,
    session?: ClientSession,
  ): Promise<Types.ObjectId> {
    const record = {
      actor: new Types.ObjectId(entry.actorId),
      action: entry.action,
      targetType: entry.targetType,
      ...(entry.targetId
        ? { targetId: new Types.ObjectId(entry.targetId) }
        : {}),
      ...(entry.details ? { details: entry.details } : {}),
    };
    const [created] = await this.model.create([record], { session });
    return created._id;
  }

  /** Adds details learned after the action (e.g. the deleted content's title). */
  async annotate(
    id: Types.ObjectId,
    details: Record<string, unknown>,
  ): Promise<void> {
    const set = Object.fromEntries(
      Object.entries(details).map(([key, value]) => [`details.${key}`, value]),
    );
    if (Object.keys(set).length === 0) return;
    await this.model.updateOne({ _id: id }, { $set: set }).exec();
  }

  /** Removes a record written for an action that then failed (never happened). */
  async discard(id: Types.ObjectId): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }

  /** The admin audit trail (GEN-07): newest entries first. */
  async findPage(
    filter: {
      action?: AuditAction;
      actorId?: string;
      targetType?: string;
      from?: Date;
      to?: Date;
    },
    page: { skip: number; limit: number },
  ): Promise<{ items: AuditLogDocument[]; total: number }> {
    const query: QueryFilter<AuditLogDocument> = {};
    if (filter.action) query.action = filter.action;
    if (filter.actorId) query.actor = new Types.ObjectId(filter.actorId);
    if (filter.targetType) query.targetType = filter.targetType;
    if (filter.from || filter.to) {
      query.createdAt = {
        ...(filter.from ? { $gte: filter.from } : {}),
        ...(filter.to ? { $lte: filter.to } : {}),
      };
    }
    const [items, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(page.skip)
        .limit(page.limit)
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { items, total };
  }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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

  async log(entry: AuditLogEntry): Promise<void> {
    await this.model.create({
      actor: new Types.ObjectId(entry.actorId),
      action: entry.action,
      targetType: entry.targetType,
      ...(entry.targetId
        ? { targetId: new Types.ObjectId(entry.targetId) }
        : {}),
      ...(entry.details ? { details: entry.details } : {}),
    });
  }
}

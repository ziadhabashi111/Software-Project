import { Injectable } from '@nestjs/common';
import { AuditAction } from '../audit/audit-action';
import { AuditLogService } from '../audit/audit-log.service';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
import { UsersService } from '../users/users.service';
import { parseRangeDate } from './date-range';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs.dto';

export interface AuditLogRow {
  id: string;
  action: AuditAction;
  actor: { id: string; name?: string; email?: string };
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
  createdAt: Date;
}

/** GEN-07: the admin view of the audit trail. */
@Injectable()
export class AdminAuditService {
  constructor(
    private readonly audit: AuditLogService,
    private readonly users: UsersService,
  ) {}

  async list(query: ListAuditLogsQueryDto): Promise<Paginated<AuditLogRow>> {
    const { items, total } = await this.audit.findPage(
      {
        ...(query.action ? { action: query.action } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.from ? { from: parseRangeDate(query.from, false) } : {}),
        ...(query.to ? { to: parseRangeDate(query.to, true) } : {}),
      },
      { skip: skipFor(query), limit: query.limit },
    );

    const actors = await this.users.findByIds([
      ...new Set(items.map((entry) => entry.actor.toString())),
    ]);
    const byId = new Map(actors.map((actor) => [actor.id, actor]));

    return toPage(
      items.map((entry) => {
        const actorId = entry.actor.toString();
        const actor = byId.get(actorId);
        return {
          id: entry.id,
          action: entry.action,
          actor: actor
            ? { id: actorId, name: actor.name, email: actor.email }
            : { id: actorId },
          targetType: entry.targetType,
          ...(entry.targetId ? { targetId: entry.targetId.toString() } : {}),
          ...(entry.details ? { details: entry.details } : {}),
          createdAt: entry.createdAt,
        };
      }),
      total,
      query,
    );
  }
}

import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { AuditAction } from '../audit/audit-action';
import { AuditLogService } from '../audit/audit-log.service';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
import { UsersService } from '../users/users.service';
import { ContentModerators, ContentType } from './content-moderators';
import type { ContentModerator, ModeratedContent } from './content-moderators';
import { ModerationMode } from './dto/moderate-content.dto';
import { ListReportsQueryDto } from './dto/list-reports.dto';
import { ReportAction, ReportDirectory } from './report-source';
import type { AdminReportRecord, ReportSource } from './report-source';

export type AdminReportRow = Omit<AdminReportRecord, 'reporterId'> & {
  reporter: { id: string; name?: string; email?: string };
};

export interface ContentModerationResult {
  type: ContentType;
  id: string;
  mode: ModerationMode;
}

export interface ReportResolution {
  id: string;
  action: ReportAction;
  contentType: ContentType;
  contentId: string;
}

function unavailable(code: string, message: string): HttpException {
  return new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    message,
    code,
  });
}

const contentUnavailable = (type: ContentType) =>
  unavailable(
    'CONTENT_MODULE_UNAVAILABLE',
    `Moderating ${type}s is not available yet`,
  );

/** GEN-09 (admin side) and GEN-10: reports and direct content moderation. */
@Injectable()
export class AdminModerationService {
  private readonly logger = new Logger(AdminModerationService.name);

  constructor(
    private readonly reportDirectory: ReportDirectory,
    private readonly moderators: ContentModerators,
    private readonly users: UsersService,
    private readonly audit: AuditLogService,
  ) {}

  /** Open reports, newest first. Empty until the report module is connected. */
  async listReports(
    query: ListReportsQueryDto,
  ): Promise<Paginated<AdminReportRow>> {
    const source = this.reportDirectory.get();
    if (!source) return toPage([], 0, query);

    const result = await source.list({
      skip: skipFor(query),
      limit: query.limit,
    });
    const reporters = await this.users.findByIds([
      ...new Set(result.items.map((report) => report.reporterId)),
    ]);
    const byId = new Map(reporters.map((reporter) => [reporter.id, reporter]));

    return toPage(
      result.items.map(({ reporterId, ...report }) => {
        const reporter = byId.get(reporterId);
        return {
          ...report,
          reporter: reporter
            ? { id: reporterId, name: reporter.name, email: reporter.email }
            : { id: reporterId },
        };
      }),
      result.total,
      query,
    );
  }

  /**
   * Hide or delete any content directly, without a report. The audit record
   * is written first (GEN-07): if it cannot be written nothing is changed,
   * and if the action then fails or finds nothing the record is removed.
   */
  async moderateContent(
    adminId: string,
    type: ContentType,
    id: string,
    mode: ModerationMode,
  ): Promise<ContentModerationResult> {
    const handler = this.moderators.get(type);
    if (!handler) throw contentUnavailable(type);

    const recordId = await this.auditContent(adminId, type, id, mode);
    let content: ModeratedContent | null;
    try {
      content = await this.apply(handler, id, mode);
    } catch (error) {
      await this.audit.discard(recordId);
      throw error;
    }
    if (!content) {
      await this.audit.discard(recordId);
      throw new NotFoundException(`${type} not found`);
    }
    await this.describe(recordId, content);
    return { type, id, mode };
  }

  /**
   * Dismiss a report, or hide or delete the reported content. The report is
   * claimed first, so when two admins act at once only one action runs. The
   * audit records are written before the content changes (GEN-07); if
   * anything fails, the records are removed and the report is open again.
   */
  async resolveReport(
    adminId: string,
    reportId: string,
    action: ReportAction,
  ): Promise<ReportResolution> {
    const source = this.requireReports();
    const report = await source.findById(reportId);
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== 'open') {
      throw new ConflictException('This report is already resolved');
    }
    const handler =
      action === ReportAction.DISMISS
        ? undefined
        : this.moderators.get(report.contentType);
    if (action !== ReportAction.DISMISS && !handler) {
      throw contentUnavailable(report.contentType);
    }

    if (!(await source.resolve(reportId, { action, adminId }))) {
      throw new ConflictException('This report is already resolved');
    }

    const written: Types.ObjectId[] = [];
    try {
      const reportRecord = await this.audit.log({
        actorId: adminId,
        action: AuditAction.REPORT_RESOLVED,
        targetType: 'report',
        targetId: reportId,
        details: {
          action,
          contentType: report.contentType,
          contentId: report.contentId,
        },
      });
      written.push(reportRecord);

      if (handler) {
        const mode =
          action === ReportAction.DELETE
            ? ModerationMode.DELETE
            : ModerationMode.HIDE;
        const contentRecord = await this.auditContent(
          adminId,
          report.contentType,
          report.contentId,
          mode,
          reportId,
        );
        written.push(contentRecord);
        const content = await this.apply(handler, report.contentId, mode);
        if (content) {
          await this.describe(contentRecord, content);
        } else {
          // Already gone: nothing was hidden or deleted by this action.
          await this.audit.discard(contentRecord);
          written.pop();
          await this.audit.annotate(reportRecord, { contentMissing: true });
        }
      }
    } catch (error) {
      for (const id of written) await this.audit.discard(id);
      await source.reopen(reportId);
      throw error;
    }

    return {
      id: reportId,
      action,
      contentType: report.contentType,
      contentId: report.contentId,
    };
  }

  private requireReports(): ReportSource {
    const source = this.reportDirectory.get();
    if (!source) {
      throw unavailable(
        'REPORTS_MODULE_UNAVAILABLE',
        'Reports are not available yet',
      );
    }
    return source;
  }

  private apply(
    handler: ContentModerator,
    id: string,
    mode: ModerationMode,
  ): Promise<ModeratedContent | null> {
    return mode === ModerationMode.DELETE
      ? handler.delete(id)
      : handler.hide(id);
  }

  /** Written before the content changes; `describe` adds title and author. */
  private auditContent(
    adminId: string,
    type: ContentType,
    id: string,
    mode: ModerationMode,
    reportId?: string,
  ): Promise<Types.ObjectId> {
    return this.audit.log({
      actorId: adminId,
      action:
        mode === ModerationMode.DELETE
          ? AuditAction.CONTENT_DELETED
          : AuditAction.CONTENT_HIDDEN,
      targetType: type,
      targetId: id,
      details: reportId ? { reportId } : {},
    });
  }

  /**
   * The action already happened and is recorded; the title and author only
   * enrich the record, so a failure here is logged rather than undoing it.
   */
  private async describe(
    recordId: Types.ObjectId,
    content: ModeratedContent,
  ): Promise<void> {
    try {
      await this.audit.annotate(recordId, {
        ...(content.title ? { title: content.title } : {}),
        ...(content.authorId ? { authorId: content.authorId } : {}),
      });
    } catch (error) {
      this.logger.error(
        `Could not add details to audit record ${recordId.toHexString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

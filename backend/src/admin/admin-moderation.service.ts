import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditAction } from '../audit/audit-action';
import { AuditLogService } from '../audit/audit-log.service';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
import { UsersService } from '../users/users.service';
import { ContentModerators, ContentType } from './content-moderators';
import type { ModeratedContent } from './content-moderators';
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

  /** Hide or delete any content directly, without a report. */
  async moderateContent(
    adminId: string,
    type: ContentType,
    id: string,
    mode: ModerationMode,
  ): Promise<ContentModerationResult> {
    const handler = this.moderators.get(type);
    if (!handler) throw contentUnavailable(type);

    const content =
      mode === ModerationMode.DELETE
        ? await handler.delete(id)
        : await handler.hide(id);
    if (!content) throw new NotFoundException(`${type} not found`);

    await this.auditContent(adminId, type, id, mode, content);
    return { type, id, mode };
  }

  /** Dismiss a report, or hide or delete the reported content. */
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

    let content: ModeratedContent | null = null;
    if (action !== ReportAction.DISMISS) {
      const handler = this.moderators.get(report.contentType);
      if (!handler) throw contentUnavailable(report.contentType);
      content =
        action === ReportAction.DELETE
          ? await handler.delete(report.contentId)
          : await handler.hide(report.contentId);
    }

    const resolved = await source.resolve(reportId, { action, adminId });
    if (!resolved) {
      throw new ConflictException('This report is already resolved');
    }

    if (content) {
      await this.auditContent(
        adminId,
        report.contentType,
        report.contentId,
        action === ReportAction.DELETE
          ? ModerationMode.DELETE
          : ModerationMode.HIDE,
        content,
        reportId,
      );
    }
    await this.audit.log({
      actorId: adminId,
      action: AuditAction.REPORT_RESOLVED,
      targetType: 'report',
      targetId: reportId,
      details: {
        action,
        contentType: report.contentType,
        contentId: report.contentId,
        ...(action !== ReportAction.DISMISS && !content
          ? { contentMissing: true }
          : {}),
      },
    });

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

  private auditContent(
    adminId: string,
    type: ContentType,
    id: string,
    mode: ModerationMode,
    content: ModeratedContent,
    reportId?: string,
  ): Promise<void> {
    return this.audit.log({
      actorId: adminId,
      action:
        mode === ModerationMode.DELETE
          ? AuditAction.CONTENT_DELETED
          : AuditAction.CONTENT_HIDDEN,
      targetType: type,
      targetId: id,
      details: {
        ...(content.title ? { title: content.title } : {}),
        ...(content.authorId ? { authorId: content.authorId } : {}),
        ...(reportId ? { reportId } : {}),
      },
    });
  }
}

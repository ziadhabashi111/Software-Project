import { Types } from 'mongoose';
import { AuditAction } from '../audit/audit-action';
import type {
  AuditLogEntry,
  AuditLogService,
} from '../audit/audit-log.service';
import type { UsersService } from '../users/users.service';
import { AdminModerationService } from './admin-moderation.service';
import { ContentModerators, ContentType } from './content-moderators';
import type { ContentModerator, ModeratedContent } from './content-moderators';
import { ModerationMode } from './dto/moderate-content.dto';
import { ReportAction, ReportDirectory } from './report-source';
import type { AdminReportRecord, ReportSource } from './report-source';

const ADMIN = new Types.ObjectId().toHexString();
const POST = new Types.ObjectId().toHexString();
const REPORT = new Types.ObjectId().toHexString();

/** An audit trail kept in memory; `failNext` makes the next write throw. */
class FakeAudit {
  rows = new Map<string, AuditLogEntry>();
  failNext = false;

  log = jest.fn((entry: AuditLogEntry) => {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('audit store down'));
    }
    const id = new Types.ObjectId();
    this.rows.set(id.toHexString(), { ...entry });
    return Promise.resolve(id);
  });

  annotate = jest.fn((id: Types.ObjectId, details: Record<string, unknown>) => {
    const row = this.rows.get(id.toHexString());
    if (row) row.details = { ...row.details, ...details };
    return Promise.resolve();
  });

  discard = jest.fn((id: Types.ObjectId) => {
    this.rows.delete(id.toHexString());
    return Promise.resolve();
  });

  actions(): AuditAction[] {
    return [...this.rows.values()].map((row) => row.action);
  }
}

/** One report, resolved atomically like the real source. */
class FakeReports implements ReportSource {
  status: 'open' | 'resolved' = 'open';

  list = () => Promise.resolve({ items: [], total: 0 });

  findById(): Promise<AdminReportRecord | null> {
    return Promise.resolve({
      id: REPORT,
      contentType: ContentType.POST,
      contentId: POST,
      reporterId: new Types.ObjectId().toHexString(),
      reason: 'spam',
      status: this.status,
      createdAt: new Date(),
    });
  }

  resolve(): Promise<boolean> {
    if (this.status !== 'open') return Promise.resolve(false);
    this.status = 'resolved';
    return Promise.resolve(true);
  }

  reopen(): Promise<void> {
    this.status = 'open';
    return Promise.resolve();
  }
}

describe('AdminModerationService: no admin action without its audit record (GEN-07, GEN-10)', () => {
  let audit: FakeAudit;
  let reports: FakeReports;
  type Act = jest.Mock<Promise<ModeratedContent | null>, [string]>;
  let hide: Act;
  let remove: Act;
  let service: AdminModerationService;

  beforeEach(() => {
    audit = new FakeAudit();
    reports = new FakeReports();
    hide = jest.fn<Promise<ModeratedContent | null>, [string]>(() =>
      Promise.resolve({ authorId: 'a1', title: 'Spam' }),
    );
    remove = jest.fn<Promise<ModeratedContent | null>, [string]>(() =>
      Promise.resolve({ authorId: 'a1', title: 'Spam' }),
    );
    const handler: ContentModerator = { hide, delete: remove };
    const moderators = new ContentModerators();
    moderators.register(ContentType.POST, handler);
    const directory = new ReportDirectory();
    directory.register(reports);
    service = new AdminModerationService(
      directory,
      moderators,
      { findByIds: () => Promise.resolve([]) } as unknown as UsersService,
      audit as unknown as AuditLogService,
    );
  });

  describe('direct moderation', () => {
    it('does not touch the content when the audit record cannot be written', async () => {
      audit.failNext = true;
      await expect(
        service.moderateContent(
          ADMIN,
          ContentType.POST,
          POST,
          ModerationMode.DELETE,
        ),
      ).rejects.toThrow('audit store down');
      expect(remove).not.toHaveBeenCalled();
    });

    it('removes the audit record when the action fails or finds nothing', async () => {
      hide.mockRejectedValueOnce(new Error('blog down'));
      await expect(
        service.moderateContent(
          ADMIN,
          ContentType.POST,
          POST,
          ModerationMode.HIDE,
        ),
      ).rejects.toThrow('blog down');
      expect(audit.rows.size).toBe(0);

      hide.mockResolvedValueOnce(null);
      await expect(
        service.moderateContent(
          ADMIN,
          ContentType.POST,
          POST,
          ModerationMode.HIDE,
        ),
      ).rejects.toThrow('not found');
      expect(audit.rows.size).toBe(0);
    });

    it('records the action with the content title and author', async () => {
      await service.moderateContent(
        ADMIN,
        ContentType.POST,
        POST,
        ModerationMode.DELETE,
      );
      const [row] = [...audit.rows.values()];
      expect(row).toMatchObject({
        action: AuditAction.CONTENT_DELETED,
        targetId: POST,
        details: { title: 'Spam', authorId: 'a1' },
      });
    });
  });

  describe('resolving a report', () => {
    it('leaves the report open and the content untouched when the audit record cannot be written', async () => {
      audit.failNext = true;
      await expect(
        service.resolveReport(ADMIN, REPORT, ReportAction.DELETE),
      ).rejects.toThrow('audit store down');
      expect(remove).not.toHaveBeenCalled();
      expect(reports.status).toBe('open');
    });

    it('reopens the report and removes its audit records when the action fails', async () => {
      hide.mockRejectedValueOnce(new Error('blog down'));
      await expect(
        service.resolveReport(ADMIN, REPORT, ReportAction.HIDE),
      ).rejects.toThrow('blog down');
      expect(reports.status).toBe('open');
      expect(audit.rows.size).toBe(0);
    });

    it('runs the action once when two admins resolve the same report', async () => {
      const results = await Promise.allSettled([
        service.resolveReport(ADMIN, REPORT, ReportAction.DELETE),
        service.resolveReport(ADMIN, REPORT, ReportAction.DELETE),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(audit.actions().sort()).toEqual(
        [AuditAction.CONTENT_DELETED, AuditAction.REPORT_RESOLVED].sort(),
      );
    });

    it('notes missing content on the report record instead of a content record', async () => {
      hide.mockResolvedValueOnce(null);
      await service.resolveReport(ADMIN, REPORT, ReportAction.HIDE);
      const rows = [...audit.rows.values()];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: AuditAction.REPORT_RESOLVED,
        details: { contentMissing: true },
      });
    });
  });
});

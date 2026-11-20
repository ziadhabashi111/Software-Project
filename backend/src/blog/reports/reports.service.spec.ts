import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ContentType } from '../../admin/content-moderators';
import { ReportAction } from '../../admin/report-source';
import type { ReportDirectory } from '../../admin/report-source';
import { Role } from '../../auth/auth.types';
import type { AuthUser } from '../../auth/auth.types';
import { ReportTargets } from './report-targets';
import { Report, ReportStatus } from './report.schema';
import { ReportsService } from './reports.service';

const reporter: AuthUser = {
  id: new Types.ObjectId().toString(),
  role: Role.USER,
};
const CONTENT_ID = new Types.ObjectId().toString();

const dto = {
  contentType: ContentType.POST,
  contentId: CONTENT_ID,
  reason: 'spam',
};

function build(
  options: {
    targetInfo?: { authorId: string; visibleToReporter: boolean } | null;
    exists?: boolean;
  } = {},
) {
  const created = {
    id: 'r1',
    contentType: ContentType.POST,
    contentId: new Types.ObjectId(CONTENT_ID),
    reporter: new Types.ObjectId(reporter.id),
    reason: 'spam',
    status: ReportStatus.OPEN,
    createdAt: new Date(),
  };
  const reports = {
    exists: jest.fn().mockResolvedValue(options.exists ?? false),
    create: jest.fn().mockResolvedValue(created),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const targets = new ReportTargets();
  if (options.targetInfo !== undefined) {
    targets.register(ContentType.POST, {
      find: jest.fn().mockResolvedValue(options.targetInfo),
    });
  }
  const directory = { register: jest.fn() };
  const service = new ReportsService(
    reports as unknown as Model<Report>,
    targets,
    directory as unknown as ReportDirectory,
  );
  return { service, reports, directory };
}

describe('ReportsService.submit (GEN-09)', () => {
  it('registers itself as a report source on startup', () => {
    const { service, directory } = build();
    service.onModuleInit();
    expect(directory.register).toHaveBeenCalledWith(service);
  });

  it('files a report for a visible item by someone other than its author', async () => {
    const { service, reports } = build({
      targetInfo: {
        authorId: new Types.ObjectId().toString(),
        visibleToReporter: true,
      },
    });
    const view = await service.submit(reporter, dto);
    expect(view).toMatchObject({ reason: 'spam', status: ReportStatus.OPEN });
    expect(reports.create).toHaveBeenCalled();
  });

  it('answers 404 when the item is missing or not visible to the reporter', async () => {
    const { service } = build({
      targetInfo: { authorId: 'x', visibleToReporter: false },
    });
    await expect(service.submit(reporter, dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // Self-reporting is pointless and is rejected before anything is stored.
  it('does not let a user report their own content', async () => {
    const { service, reports } = build({
      targetInfo: { authorId: reporter.id, visibleToReporter: true },
    });
    await expect(service.submit(reporter, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(reports.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate report found before the write', async () => {
    const { service, reports } = build({
      targetInfo: { authorId: 'x', visibleToReporter: true },
      exists: true,
    });
    await expect(service.submit(reporter, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(reports.create).not.toHaveBeenCalled();
  });

  // Two identical requests race past the exists() check; the unique index catches the second.
  it('turns a duplicate-key error from a race into 409', async () => {
    const { service, reports } = build({
      targetInfo: { authorId: 'x', visibleToReporter: true },
    });
    reports.create.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 11000 }),
    );
    await expect(service.submit(reporter, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  // With no checker registered for a content type, the id is accepted (resolving copes later).
  it('accepts a report when no target checker is registered for the type', async () => {
    const { service, reports } = build(); // no target registered
    await expect(service.submit(reporter, dto)).resolves.toMatchObject({
      status: ReportStatus.OPEN,
    });
    expect(reports.create).toHaveBeenCalled();
  });
});

describe('ReportsService.resolve', () => {
  it('reports success only when it actually closed an open report', async () => {
    const { service, reports } = build();
    const ok = await service.resolve(new Types.ObjectId().toString(), {
      action: ReportAction.DISMISS,
      adminId: new Types.ObjectId().toString(),
    });
    expect(ok).toBe(true);

    // A second admin resolving the same report changes nothing → false.
    reports.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
    const again = await service.resolve(new Types.ObjectId().toString(), {
      action: ReportAction.DISMISS,
      adminId: new Types.ObjectId().toString(),
    });
    expect(again).toBe(false);
  });

  it('returns false for a malformed id without hitting the database', async () => {
    const { service, reports } = build();
    expect(
      await service.resolve('not-an-id', {
        action: ReportAction.DISMISS,
        adminId: 'a',
      }),
    ).toBe(false);
    expect(reports.updateOne).not.toHaveBeenCalled();
  });
});

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import type { ContentType } from '../../admin/content-moderators';
import { ReportDirectory } from '../../admin/report-source';
import type {
  AdminReportRecord,
  ReportAction,
  ReportSource,
} from '../../admin/report-source';
import type { AuthUser } from '../../auth/auth.types';
import type { CreateReportDto } from './dto/create-report.dto';
import { ReportTargets } from './report-targets';
import { Report, ReportStatus } from './report.schema';
import type { ReportDocument } from './report.schema';

/** What the reporter gets back. */
export interface ReportView {
  id: string;
  contentType: ContentType;
  contentId: string;
  reason: string;
  status: ReportStatus;
  createdAt: Date;
}

const toView = (report: ReportDocument): ReportView => ({
  id: report.id,
  contentType: report.contentType,
  contentId: report.contentId.toString(),
  reason: report.reason,
  status: report.status,
  createdAt: report.createdAt,
});

const toAdminRecord = (report: ReportDocument): AdminReportRecord => ({
  id: report.id,
  contentType: report.contentType,
  contentId: report.contentId.toString(),
  reporterId: report.reporter.toString(),
  reason: report.reason,
  status: report.status,
  createdAt: report.createdAt,
});

const isDuplicateKey = (error: unknown): boolean =>
  (error as { code?: number }).code === 11000;

const alreadyReported = (): ConflictException =>
  new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: 'You have already reported this',
    code: 'ALREADY_REPORTED',
  });

/**
 * GEN-09: report submission (registered users) and the admin side's
 * `ReportSource` (GEN-10), registered with the admin `ReportDirectory`.
 */
@Injectable()
export class ReportsService implements ReportSource, OnModuleInit {
  constructor(
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    private readonly targets: ReportTargets,
    private readonly directory: ReportDirectory,
  ) {}

  onModuleInit(): void {
    this.directory.register(this);
  }

  /**
   * Reports an item once. The item must exist and be visible to the
   * reporter; users cannot report their own content.
   */
  async submit(reporter: AuthUser, dto: CreateReportDto): Promise<ReportView> {
    const target = this.targets.get(dto.contentType);
    if (target) {
      const info = await target.find(dto.contentId, reporter);
      if (!info || !info.visibleToReporter) {
        throw new NotFoundException(`${dto.contentType} not found`);
      }
      if (info.authorId === reporter.id) {
        throw new BadRequestException('You cannot report your own content');
      }
    }
    // Reviews and itineraries register their checkers from their own modules;
    // if a module is not loaded the id is accepted and resolving copes with
    // missing content.

    const filter = {
      reporter: new Types.ObjectId(reporter.id),
      contentType: dto.contentType,
      contentId: new Types.ObjectId(dto.contentId),
    };
    if (await this.reports.exists(filter)) throw alreadyReported();
    try {
      const report = await this.reports.create({
        ...filter,
        reason: dto.reason,
      });
      return toView(report);
    } catch (error) {
      // Two identical requests at once: the unique index keeps only one.
      if (isDuplicateKey(error)) throw alreadyReported();
      throw error;
    }
  }

  // ----- ReportSource (read and resolved by the admin module) -----

  async list(query: {
    skip: number;
    limit: number;
  }): Promise<{ items: AdminReportRecord[]; total: number }> {
    const filter = { status: ReportStatus.OPEN };
    const [items, total] = await Promise.all([
      this.reports
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit),
      this.reports.countDocuments(filter),
    ]);
    return { items: items.map(toAdminRecord), total };
  }

  async findById(id: string): Promise<AdminReportRecord | null> {
    if (!isValidObjectId(id)) return null;
    const report = await this.reports.findById(id);
    return report ? toAdminRecord(report) : null;
  }

  /** Atomic: only one of two admins resolving at once succeeds. */
  async resolve(
    id: string,
    resolution: { action: ReportAction; adminId: string },
  ): Promise<boolean> {
    if (!isValidObjectId(id)) return false;
    const result = await this.reports.updateOne(
      { _id: id, status: ReportStatus.OPEN },
      {
        $set: {
          status: ReportStatus.RESOLVED,
          resolution: {
            action: resolution.action,
            admin: new Types.ObjectId(resolution.adminId),
            resolvedAt: new Date(),
          },
        },
      },
    );
    return result.modifiedCount === 1;
  }
}

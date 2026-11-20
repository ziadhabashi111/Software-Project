import { Injectable } from '@nestjs/common';
import type { ContentType } from './content-moderators';

/** What an administrator can do with an open report (GEN-10). */
export enum ReportAction {
  DISMISS = 'dismiss',
  HIDE = 'hide',
  DELETE = 'delete',
}

export interface AdminReportRecord {
  id: string;
  contentType: ContentType;
  contentId: string;
  reporterId: string;
  reason: string;
  /** `open` until an administrator resolves it. */
  status: 'open' | 'resolved';
  createdAt: Date;
}

/**
 * Implemented by the module that owns the Report schema (Ahmed, GEN-09) and
 * registered once in `ReportDirectory`.
 */
export interface ReportSource {
  /** Open reports only, newest first. */
  list(query: {
    skip: number;
    limit: number;
  }): Promise<{ items: AdminReportRecord[]; total: number }>;
  findById(id: string): Promise<AdminReportRecord | null>;
  /**
   * Marks an open report resolved. Must be atomic: returns `false` when the
   * report is unknown or was already resolved (two admins acting at once).
   */
  resolve(
    id: string,
    resolution: { action: ReportAction; adminId: string },
  ): Promise<boolean>;
  /** Undoes `resolve` when the admin's action failed: the report is open again. */
  reopen(id: string): Promise<void>;
}

/** Holds the report module's source once it registers. */
@Injectable()
export class ReportDirectory {
  private source?: ReportSource;

  register(source: ReportSource): void {
    this.source = source;
  }

  get(): ReportSource | undefined {
    return this.source;
  }
}

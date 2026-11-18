import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../auth/auth.types';
import type { ContentType } from '../../admin/content-moderators';

/** What the report module needs to know about the reported item. */
export interface ReportTargetInfo {
  authorId: string;
  /** False when the reporter may not see it (draft, private, hidden). */
  visibleToReporter: boolean;
}

/**
 * Implemented by the module that owns a content type, so a report is only
 * accepted for an item that exists and that the reporter can see.
 * Return `null` when the id does not exist.
 *
 * @example (in the itinerary or review module)
 *   onModuleInit() { this.targets.register(ContentType.ITINERARY, this); }
 *   async find(id, reporter) { ... }
 */
export interface ReportTarget {
  find(id: string, reporter: AuthUser): Promise<ReportTargetInfo | null>;
}

/** One checker per content type; posts and comments are registered by the blog. */
@Injectable()
export class ReportTargets {
  private readonly targets = new Map<ContentType, ReportTarget>();

  register(type: ContentType, target: ReportTarget): void {
    this.targets.set(type, target);
  }

  get(type: ContentType): ReportTarget | undefined {
    return this.targets.get(type);
  }
}

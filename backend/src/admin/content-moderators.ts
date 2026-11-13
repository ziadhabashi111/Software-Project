import { Injectable } from '@nestjs/common';

/** Content an administrator can moderate (GEN-10). */
export enum ContentType {
  POST = 'post',
  COMMENT = 'comment',
  REVIEW = 'review',
  ITINERARY = 'itinerary',
}

/** What the admin audit trail records about the moderated item. */
export interface ModeratedContent {
  authorId?: string;
  title?: string;
}

/**
 * Implemented by the module that owns the content: Ahmed (posts, comments),
 * Amina (reviews) and the itinerary module. Both methods must be safe to call
 * twice. `hide` sets `isHidden` (the content then shows only to its author and
 * admins); `delete` removes it. Return `null` when the id does not exist.
 */
export interface ContentModerator {
  hide(id: string): Promise<ModeratedContent | null>;
  delete(id: string): Promise<ModeratedContent | null>;
}

/** Registry the content modules plug into, one handler per content type. */
@Injectable()
export class ContentModerators {
  private readonly handlers = new Map<ContentType, ContentModerator>();

  register(type: ContentType, handler: ContentModerator): void {
    this.handlers.set(type, handler);
  }

  get(type: ContentType): ContentModerator | undefined {
    return this.handlers.get(type);
  }
}

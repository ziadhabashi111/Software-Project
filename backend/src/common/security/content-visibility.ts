import { NotFoundException } from '@nestjs/common';
import { Role } from '../../auth/auth.types';
import type { AuthUser } from '../../auth/auth.types';

export interface ModeratableContent {
  /** Set by an admin through GEN-10. Missing means visible. */
  isHidden?: boolean;
  authorId: string | { toString(): string };
}

/**
 * GEN-10: hidden content (posts, comments, reviews, itineraries) is visible
 * only to its author and to administrators. Use this wherever content is read
 * or listed, so a guest or another user never sees it.
 */
export function canViewContent(
  content: ModeratableContent,
  user?: Pick<AuthUser, 'id' | 'role'>,
): boolean {
  if (!content.isHidden) return true;
  if (!user) return false;
  return user.role === Role.ADMIN || content.authorId.toString() === user.id;
}

/** Same rule for a single item: answers 404 so hidden content is not revealed. */
export function assertContentVisible(
  content: ModeratableContent,
  user?: Pick<AuthUser, 'id' | 'role'>,
): void {
  if (!canViewContent(content, user)) {
    throw new NotFoundException('Resource not found');
  }
}

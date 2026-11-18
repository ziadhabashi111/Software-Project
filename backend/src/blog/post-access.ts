import { NotFoundException } from '@nestjs/common';
import { isValidObjectId, Model } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { canViewContent } from '../common/security/content-visibility';
import { Post, PostStatus } from './schemas/post.schema';
import type { PostDocument } from './schemas/post.schema';

/**
 * Loads a post that `user` may interact with: published, and not hidden
 * unless the user is its author or an admin (GEN-10). Anything else answers
 * 404, so drafts and hidden posts are never revealed.
 */
export async function loadPublishedPost(
  posts: Model<Post>,
  id: string,
  user?: Pick<AuthUser, 'id' | 'role'>,
): Promise<PostDocument> {
  const post = isValidObjectId(id) ? await posts.findById(id) : null;
  if (
    !post ||
    post.status !== PostStatus.PUBLISHED ||
    !canViewContent({ isHidden: post.isHidden, authorId: post.author }, user)
  ) {
    throw new NotFoundException('Post not found');
  }
  return post;
}

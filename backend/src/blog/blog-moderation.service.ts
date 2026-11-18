import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { ContentModerators, ContentType } from '../admin/content-moderators';
import type {
  ContentModerator,
  ModeratedContent,
} from '../admin/content-moderators';
import type { AuthUser } from '../auth/auth.types';
import { canViewContent } from '../common/security/content-visibility';
import { ReportTargets } from './reports/report-targets';
import type { ReportTargetInfo } from './reports/report-targets';
import { Comment } from './schemas/comment.schema';
import type { CommentDocument } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Post, PostStatus } from './schemas/post.schema';
import type { PostDocument } from './schemas/post.schema';

const describePost = (post: PostDocument): ModeratedContent => ({
  authorId: post.author.toString(),
  title: post.title,
});

const describeComment = (comment: CommentDocument): ModeratedContent => ({
  authorId: comment.author.toString(),
  title: `Comment: ${comment.body.slice(0, 60)}`,
});

const visibleTo = (
  item: { isHidden: boolean; author: { toString(): string } },
  user: AuthUser,
): boolean =>
  canViewContent({ isHidden: item.isHidden, authorId: item.author }, user);

/**
 * GEN-10 hooks for posts and comments (used by the admin module) and the
 * GEN-09 report checks. All methods are safe to call twice and return `null`
 * when the id does not exist.
 */
@Injectable()
export class BlogModerationService implements OnModuleInit {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(Like.name) private readonly likes: Model<Like>,
    private readonly moderators: ContentModerators,
    private readonly reportTargets: ReportTargets,
  ) {}

  onModuleInit(): void {
    const postModerator: ContentModerator = {
      hide: (id) => this.hidePost(id),
      delete: (id) => this.deletePost(id),
    };
    const commentModerator: ContentModerator = {
      hide: (id) => this.hideComment(id),
      delete: (id) => this.deleteComment(id),
    };
    this.moderators.register(ContentType.POST, postModerator);
    this.moderators.register(ContentType.COMMENT, commentModerator);
    this.reportTargets.register(ContentType.POST, {
      find: (id, reporter) => this.postTarget(id, reporter),
    });
    this.reportTargets.register(ContentType.COMMENT, {
      find: (id, reporter) => this.commentTarget(id, reporter),
    });
  }

  async hidePost(id: string): Promise<ModeratedContent | null> {
    const post = await this.setPostHidden(id, true);
    return post ? describePost(post) : null;
  }

  async unhidePost(id: string): Promise<ModeratedContent | null> {
    const post = await this.setPostHidden(id, false);
    return post ? describePost(post) : null;
  }

  /** Removes the post with its comments and likes. */
  async deletePost(id: string): Promise<ModeratedContent | null> {
    if (!isValidObjectId(id)) return null;
    const post = await this.posts.findByIdAndDelete(id);
    if (!post) return null;
    await Promise.all([
      this.comments.deleteMany({ post: post._id }),
      this.likes.deleteMany({ post: post._id }),
    ]);
    return describePost(post);
  }

  /**
   * `commentCount` counts visible comments only (it feeds the interaction
   * score, BLG-09), so hiding lowers it and unhiding raises it again, but
   * only when the state really changes; calling twice is safe.
   */
  async hideComment(id: string): Promise<ModeratedContent | null> {
    return this.setCommentHidden(id, true);
  }

  async unhideComment(id: string): Promise<ModeratedContent | null> {
    return this.setCommentHidden(id, false);
  }

  /** Removes the comment; a visible one also lowers the post's count. */
  async deleteComment(id: string): Promise<ModeratedContent | null> {
    if (!isValidObjectId(id)) return null;
    const comment = await this.comments.findByIdAndDelete(id);
    if (!comment) return null;
    if (!comment.isHidden) await this.changeCommentCount(comment.post, -1);
    return describeComment(comment);
  }

  /** A post can be reported once published and visible to the reporter. */
  private async postTarget(
    id: string,
    reporter: AuthUser,
  ): Promise<ReportTargetInfo | null> {
    if (!isValidObjectId(id)) return null;
    const post = await this.posts.findById(id);
    if (!post) return null;
    return {
      authorId: post.author.toString(),
      visibleToReporter:
        post.status === PostStatus.PUBLISHED && visibleTo(post, reporter),
    };
  }

  /** A comment can be reported when it and its published post are visible. */
  private async commentTarget(
    id: string,
    reporter: AuthUser,
  ): Promise<ReportTargetInfo | null> {
    if (!isValidObjectId(id)) return null;
    const comment = await this.comments.findById(id);
    if (!comment) return null;
    const post = await this.posts.findById(comment.post);
    return {
      authorId: comment.author.toString(),
      visibleToReporter:
        !!post &&
        post.status === PostStatus.PUBLISHED &&
        visibleTo(post, reporter) &&
        visibleTo(comment, reporter),
    };
  }

  private setPostHidden(
    id: string,
    isHidden: boolean,
  ): Promise<PostDocument | null> {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return this.posts.findByIdAndUpdate(
      id,
      { isHidden },
      { returnDocument: 'after' },
    );
  }

  private async setCommentHidden(
    id: string,
    isHidden: boolean,
  ): Promise<ModeratedContent | null> {
    if (!isValidObjectId(id)) return null;
    // Only the request that actually flips the flag adjusts the count.
    const changed = await this.comments.findOneAndUpdate(
      { _id: id, isHidden: !isHidden },
      { isHidden },
      { returnDocument: 'after' },
    );
    if (changed) {
      await this.changeCommentCount(changed.post, isHidden ? -1 : 1);
      return describeComment(changed);
    }
    const comment = await this.comments.findById(id);
    return comment ? describeComment(comment) : null;
  }

  private async changeCommentCount(
    postId: Types.ObjectId,
    delta: 1 | -1,
  ): Promise<void> {
    await this.posts.updateOne(
      delta < 0 ? { _id: postId, commentCount: { $gt: 0 } } : { _id: postId },
      { $inc: { commentCount: delta } },
    );
  }
}

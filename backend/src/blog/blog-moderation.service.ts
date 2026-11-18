import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { ContentModerators, ContentType } from '../admin/content-moderators';
import type {
  ContentModerator,
  ModeratedContent,
} from '../admin/content-moderators';
import type { AuthUser } from '../auth/auth.types';
import { canViewContent } from '../common/security/content-visibility';
import { UploadsService } from '../uploads/uploads.service';
import { ReportTargets } from './reports/report-targets';
import type { ReportTargetInfo } from './reports/report-targets';
import { Comment } from './schemas/comment.schema';
import type { CommentDocument } from './schemas/comment.schema';
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
    private readonly moderators: ContentModerators,
    private readonly reportTargets: ReportTargets,
    private readonly uploads: UploadsService,
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

  /**
   * Removes the post, its comments and its image files. The files are
   * removed as the post's author (who uploaded them, GEN-08), so an admin
   * delete (GEN-10) cleans them up too. Best-effort: a file that is
   * already gone (or a failed removal) never fails the moderation.
   */
  async deletePost(id: string): Promise<ModeratedContent | null> {
    if (!isValidObjectId(id)) return null;
    const post = await this.posts.findByIdAndDelete(id);
    if (!post) return null;
    await this.comments.deleteMany({ post: post._id });
    const uploader = post.author.toString();
    await Promise.allSettled(
      post.images.map((image) => this.uploads.remove(image.url, uploader)),
    );
    return describePost(post);
  }

  async hideComment(id: string): Promise<ModeratedContent | null> {
    const comment = await this.setCommentHidden(id, true);
    return comment ? describeComment(comment) : null;
  }

  async unhideComment(id: string): Promise<ModeratedContent | null> {
    const comment = await this.setCommentHidden(id, false);
    return comment ? describeComment(comment) : null;
  }

  /** Removes the comment and updates its post's comment count. */
  async deleteComment(id: string): Promise<ModeratedContent | null> {
    if (!isValidObjectId(id)) return null;
    const comment = await this.comments.findByIdAndDelete(id);
    if (!comment) return null;
    await this.posts.updateOne(
      { _id: comment.post, commentCount: { $gt: 0 } },
      { $inc: { commentCount: -1 } },
    );
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

  private setCommentHidden(
    id: string,
    isHidden: boolean,
  ): Promise<CommentDocument | null> {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return this.comments.findByIdAndUpdate(
      id,
      { isHidden },
      { returnDocument: 'after' },
    );
  }
}

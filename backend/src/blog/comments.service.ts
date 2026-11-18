import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import type { QueryFilter } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
import { canViewContent } from '../common/security/content-visibility';
import { UserStatus } from '../users/user-status';
import { UsersService } from '../users/users.service';
import { BlogModerationService } from './blog-moderation.service';
import type { ListCommentsQueryDto } from './dto/comment.dto';
import { loadPublishedPost } from './post-access';
import { Comment } from './schemas/comment.schema';
import type { CommentDocument } from './schemas/comment.schema';
import { Post } from './schemas/post.schema';

/** Shown instead of the name of a deactivated or missing account (ACC-12). */
export const DELETED_USER = 'Deleted user';

export interface CommentView {
  id: string;
  postId: string;
  /** `id` is null for a deactivated account. */
  author: { id: string | null; name: string };
  body: string;
  isHidden: boolean;
  /** When the author last edited it, or null. */
  editedAt: Date | null;
  createdAt: Date;
}

/**
 * BLG-05: comment on a published post (1-500 characters), listed oldest
 * first. BLG-07: authors edit and delete their own comments.
 */
@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    private readonly users: UsersService,
    private readonly moderation: BlogModerationService,
  ) {}

  async create(
    user: AuthUser,
    postId: string,
    body: string,
  ): Promise<CommentView> {
    const post = await loadPublishedPost(this.posts, postId, user);
    const comment = await this.comments.create({
      post: post._id,
      author: new Types.ObjectId(user.id),
      body,
    });
    await this.posts.updateOne(
      { _id: post._id },
      { $inc: { commentCount: 1 } },
    );
    return (await this.withAuthors([comment]))[0];
  }

  /**
   * Comments of a published post in chronological order. Hidden comments
   * show only to their author and admins (GEN-10).
   */
  async list(
    postId: string,
    query: ListCommentsQueryDto,
    viewer?: AuthUser,
  ): Promise<Paginated<CommentView>> {
    const post = await loadPublishedPost(this.posts, postId, viewer);
    const filter: QueryFilter<Comment> = { post: post._id };
    if (viewer?.role !== Role.ADMIN) {
      filter.$or = [
        { isHidden: { $ne: true } },
        ...(viewer ? [{ author: new Types.ObjectId(viewer.id) }] : []),
      ];
    }
    const [items, total] = await Promise.all([
      this.comments
        .find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .skip(skipFor(query))
        .limit(query.limit),
      this.comments.countDocuments(filter),
    ]);
    return toPage(await this.withAuthors(items), total, query);
  }

  /** BLG-07: only the author edits; the post must still be published. */
  async update(
    user: AuthUser,
    commentId: string,
    body: string,
  ): Promise<CommentView> {
    const comment = await this.loadOwn(user, commentId);
    await loadPublishedPost(this.posts, comment.post.toString(), user);
    comment.body = body;
    comment.editedAt = new Date();
    await comment.save();
    return (await this.withAuthors([comment]))[0];
  }

  /** BLG-07: only the author deletes; the post's comment count follows. */
  async remove(user: AuthUser, commentId: string): Promise<void> {
    const comment = await this.loadOwn(user, commentId);
    await this.moderation.deleteComment(comment.id);
  }

  /**
   * Others get 403 for a comment they can see and 404 otherwise, so hidden
   * comments are not revealed.
   */
  private async loadOwn(
    user: AuthUser,
    commentId: string,
  ): Promise<CommentDocument> {
    const comment = isValidObjectId(commentId)
      ? await this.comments.findById(commentId)
      : null;
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.author.toString() !== user.id) {
      const visible = canViewContent(
        { isHidden: comment.isHidden, authorId: comment.author },
        user,
      );
      if (visible) {
        throw new ForbiddenException('You can only change your own comments');
      }
      throw new NotFoundException('Comment not found');
    }
    return comment;
  }

  private async withAuthors(
    comments: CommentDocument[],
  ): Promise<CommentView[]> {
    const authors = await this.users.findByIds([
      ...new Set(comments.map((c) => c.author.toString())),
    ]);
    const byId = new Map(authors.map((user) => [user.id, user]));
    return comments.map((comment) => {
      const author = byId.get(comment.author.toString());
      const active = author && author.status !== UserStatus.DEACTIVATED;
      return {
        id: comment.id,
        postId: comment.post.toString(),
        author: active
          ? { id: author.id, name: author.name }
          : { id: null, name: DELETED_USER },
        body: comment.body,
        isHidden: comment.isHidden,
        editedAt: comment.editedAt ?? null,
        createdAt: comment.createdAt,
      };
    });
  }
}

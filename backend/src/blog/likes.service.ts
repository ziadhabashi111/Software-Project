import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { loadPublishedPost } from './post-access';
import { Like } from './schemas/like.schema';
import { Post } from './schemas/post.schema';

export interface LikeState {
  postId: string;
  liked: boolean;
  likeCount: number;
}

const isDuplicateKey = (error: unknown): boolean =>
  (error as { code?: number }).code === 11000;

/**
 * BLG-06: a user likes a published post at most once and can remove the
 * like. The unique `{ post, user }` index decides; `likeCount` only changes
 * when a like is really added or removed, so it stays exact under
 * parallel requests.
 */
@Injectable()
export class LikesService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Like.name) private readonly likes: Model<Like>,
  ) {}

  async like(user: AuthUser, postId: string): Promise<LikeState> {
    const post = await loadPublishedPost(this.posts, postId, user);
    try {
      await this.likes.create({
        post: post._id,
        user: new Types.ObjectId(user.id),
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: 'You already like this post',
          code: 'ALREADY_LIKED',
        });
      }
      throw error;
    }
    return this.bump(post._id, 1);
  }

  async unlike(user: AuthUser, postId: string): Promise<LikeState> {
    const post = await loadPublishedPost(this.posts, postId, user);
    const { deletedCount } = await this.likes.deleteOne({
      post: post._id,
      user: new Types.ObjectId(user.id),
    });
    if (deletedCount !== 1) {
      throw new NotFoundException('You have not liked this post');
    }
    return this.bump(post._id, -1);
  }

  /** Whether `userId` likes each of the posts (for post pages, BLG-02). */
  async likedBy(
    userId: string,
    postIds: Types.ObjectId[],
  ): Promise<Set<string>> {
    const rows = await this.likes
      .find({ user: new Types.ObjectId(userId), post: { $in: postIds } })
      .select('post');
    return new Set(rows.map((row) => row.post.toString()));
  }

  private async bump(
    postId: Types.ObjectId,
    delta: 1 | -1,
  ): Promise<LikeState> {
    const updated = await this.posts.findOneAndUpdate(
      delta < 0 ? { _id: postId, likeCount: { $gt: 0 } } : { _id: postId },
      { $inc: { likeCount: delta } },
      { returnDocument: 'after' },
    );
    const likeCount =
      updated?.likeCount ?? (await this.posts.findById(postId))?.likeCount ?? 0;
    return { postId: postId.toString(), liked: delta > 0, likeCount };
  }
}

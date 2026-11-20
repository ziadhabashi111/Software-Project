import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { LikesService } from './likes.service';
import { Like } from './schemas/like.schema';
import { Post, PostStatus } from './schemas/post.schema';

const POST_ID = new Types.ObjectId();
const user: AuthUser = { id: new Types.ObjectId().toString(), role: Role.USER };

function publishedPost() {
  return {
    _id: POST_ID,
    status: PostStatus.PUBLISHED,
    isHidden: false,
    author: new Types.ObjectId(),
    likeCount: 0,
  };
}

const duplicateKey = () => Object.assign(new Error('dup'), { code: 11000 });

/** A thenable query stub so `await model.find(...).select(...)` resolves to `rows`. */
function query<T>(rows: T) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  (q as { then: unknown }).then = (resolve: (value: T) => unknown) =>
    resolve(rows);
  return q;
}

function build(options: { post?: unknown; likeCountAfter?: number } = {}) {
  const post = options.post === undefined ? publishedPost() : options.post;
  const posts = {
    findById: jest.fn().mockResolvedValue(post),
    findOneAndUpdate: jest
      .fn()
      .mockResolvedValue({ likeCount: options.likeCountAfter ?? 1 }),
  };
  const likes = {
    create: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    find: jest.fn(() => query([])),
  };
  const service = new LikesService(
    posts as unknown as Model<Post>,
    likes as unknown as Model<Like>,
  );
  return { service, posts, likes };
}

describe('LikesService (BLG-06)', () => {
  describe('like', () => {
    it('records the like and returns the new count', async () => {
      const { service, likes, posts } = build({ likeCountAfter: 1 });
      const state = await service.like(user, POST_ID.toString());
      expect(likes.create).toHaveBeenCalledWith({
        post: POST_ID,
        user: new Types.ObjectId(user.id),
      });
      // The count is bumped with $inc, not recomputed, so it stays exact.
      expect(posts.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: POST_ID },
        { $inc: { likeCount: 1 } },
        { returnDocument: 'after' },
      );
      expect(state).toEqual({
        postId: POST_ID.toString(),
        liked: true,
        likeCount: 1,
      });
    });

    // The unique {post, user} index is what enforces one like; a second attempt is 409.
    it('rejects a second like from the same user with 409 and never bumps the count', async () => {
      const { service, likes, posts } = build();
      likes.create.mockRejectedValueOnce(duplicateKey());
      await expect(
        service.like(user, POST_ID.toString()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(posts.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('does not let you like an unpublished or missing post', async () => {
      const { service } = build({ post: null });
      await expect(
        service.like(user, POST_ID.toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('unlike', () => {
    it('removes the like and lowers the count only when one existed', async () => {
      const { service, posts } = build({ likeCountAfter: 0 });
      const state = await service.unlike(user, POST_ID.toString());
      // The $gt:0 guard stops the count going negative under a double unlike.
      expect(posts.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: POST_ID, likeCount: { $gt: 0 } },
        { $inc: { likeCount: -1 } },
        { returnDocument: 'after' },
      );
      expect(state).toEqual({
        postId: POST_ID.toString(),
        liked: false,
        likeCount: 0,
      });
    });

    it('answers 404 when the user had not liked the post', async () => {
      const { service, likes, posts } = build();
      likes.deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
      await expect(
        service.unlike(user, POST_ID.toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(posts.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('likedBy', () => {
    it('returns the set of liked post ids as strings', async () => {
      const { service, likes } = build();
      const liked = new Types.ObjectId();
      likes.find.mockReturnValueOnce(query([{ post: liked }]));
      const set = await service.likedBy(user.id, [liked]);
      expect(set.has(liked.toString())).toBe(true);
    });

    it('is empty when the user liked none of them', async () => {
      const { service } = build();
      const set = await service.likedBy(user.id, [new Types.ObjectId()]);
      expect(set.size).toBe(0);
    });
  });
});

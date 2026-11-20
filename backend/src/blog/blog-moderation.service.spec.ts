import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { ContentModerators } from '../admin/content-moderators';
import type { UploadsService } from '../uploads/uploads.service';
import { BlogModerationService } from './blog-moderation.service';
import { ReportTargets } from './reports/report-targets';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Post } from './schemas/post.schema';

const VALID_ID = new Types.ObjectId().toString();

function postDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    author: new Types.ObjectId(),
    title: 'Trip',
    isHidden: false,
    images: [{ url: '/uploads/a.jpg' }, { url: '/uploads/b.jpg' }],
    ...overrides,
  };
}

function commentDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    post: new Types.ObjectId(),
    author: new Types.ObjectId(),
    body: 'Some comment body',
    isHidden: false,
    ...overrides,
  };
}

function build(
  overrides: {
    post?: unknown;
    deletedPost?: unknown;
    deletedComment?: unknown;
    flipped?: unknown;
  } = {},
) {
  // Resolve an override honouring an explicit `null` (so "already gone" is testable).
  const pick = (key: keyof typeof overrides, dflt: unknown) =>
    key in overrides ? overrides[key] : dflt;
  const posts = {
    findByIdAndUpdate: jest.fn().mockResolvedValue(pick('post', postDoc())),
    findByIdAndDelete: jest
      .fn()
      .mockResolvedValue(pick('deletedPost', postDoc())),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const comments = {
    findByIdAndDelete: jest
      .fn()
      .mockResolvedValue(pick('deletedComment', commentDoc())),
    findOneAndUpdate: jest
      .fn()
      .mockResolvedValue(pick('flipped', commentDoc())),
    findById: jest.fn().mockResolvedValue(commentDoc()),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  };
  const likes = {
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  };
  const moderators = { register: jest.fn() };
  const reportTargets = new ReportTargets();
  const uploads = { remove: jest.fn().mockResolvedValue(true) };
  const service = new BlogModerationService(
    posts as unknown as Model<Post>,
    comments as unknown as Model<Comment>,
    likes as unknown as Model<Like>,
    moderators as unknown as ContentModerators,
    reportTargets,
    uploads as unknown as UploadsService,
  );
  return { service, posts, comments, likes, uploads };
}

describe('BlogModerationService.deletePost (GEN-10, GEN-08)', () => {
  it('removes the post, its comments, its likes and its image files', async () => {
    const post = postDoc();
    const { service, comments, likes, uploads } = build({ deletedPost: post });
    const result = await service.deletePost(VALID_ID);

    expect(comments.deleteMany).toHaveBeenCalledWith({ post: post._id });
    expect(likes.deleteMany).toHaveBeenCalledWith({ post: post._id });
    // The files are removed as the post's author, who uploaded them (GEN-08 ownership).
    expect(uploads.remove).toHaveBeenCalledWith(
      '/uploads/a.jpg',
      post.author.toString(),
    );
    expect(uploads.remove).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ authorId: post.author.toString(), title: 'Trip' });
  });

  it('returns null for a malformed id without touching the database', async () => {
    const { service, posts } = build();
    expect(await service.deletePost('not-an-id')).toBeNull();
    expect(posts.findByIdAndDelete).not.toHaveBeenCalled();
  });

  it('returns null when the post is already gone', async () => {
    const { service, comments } = build({ deletedPost: null });
    expect(await service.deletePost(VALID_ID)).toBeNull();
    expect(comments.deleteMany).not.toHaveBeenCalled();
  });
});

describe('BlogModerationService.deleteComment', () => {
  // A visible comment counts toward the post total, so deleting it lowers the count.
  it('lowers the post comment count when deleting a visible comment', async () => {
    const visible = commentDoc({ isHidden: false });
    const { service, posts } = build({ deletedComment: visible });
    await service.deleteComment(VALID_ID);
    expect(posts.updateOne).toHaveBeenCalledWith(
      { _id: visible.post, commentCount: { $gt: 0 } },
      { $inc: { commentCount: -1 } },
    );
  });

  // A hidden comment was never counted, so deleting it must not change the count.
  it('does not change the count when deleting an already-hidden comment', async () => {
    const hidden = commentDoc({ isHidden: true });
    const { service, posts } = build({ deletedComment: hidden });
    await service.deleteComment(VALID_ID);
    expect(posts.updateOne).not.toHaveBeenCalled();
  });
});

describe('BlogModerationService hide/unhide', () => {
  it('hidePost flips the flag and describes the post', async () => {
    const { service, posts } = build();
    const result = await service.hidePost(VALID_ID);
    expect(posts.findByIdAndUpdate).toHaveBeenCalledWith(
      VALID_ID,
      { isHidden: true },
      { returnDocument: 'after' },
    );
    expect(result).toMatchObject({ title: 'Trip' });
  });

  // Hiding a comment that actually changed state lowers the count once.
  it('hideComment lowers the count only when it really flipped the flag', async () => {
    const flipped = commentDoc({ isHidden: true });
    const { service, posts } = build({ flipped });
    await service.hideComment(VALID_ID);
    expect(posts.updateOne).toHaveBeenCalledWith(
      { _id: flipped.post, commentCount: { $gt: 0 } },
      { $inc: { commentCount: -1 } },
    );
  });

  // Hiding an already-hidden comment is a no-op for the count (idempotent).
  it('hideComment changes nothing when the comment was already hidden', async () => {
    const { service, posts } = build({ flipped: null });
    await service.hideComment(VALID_ID);
    expect(posts.updateOne).not.toHaveBeenCalled();
  });
});

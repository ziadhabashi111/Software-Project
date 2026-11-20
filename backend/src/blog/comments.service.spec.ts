import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { UserStatus } from '../users/user-status';
import type { UsersService } from '../users/users.service';
import type { BlogModerationService } from './blog-moderation.service';
import { CommentsService, DELETED_USER } from './comments.service';
import { Comment } from './schemas/comment.schema';
import { Post, PostStatus } from './schemas/post.schema';

const POST_ID = new Types.ObjectId();
const user: AuthUser = { id: new Types.ObjectId().toString(), role: Role.USER };

const publishedPost = () => ({
  _id: POST_ID,
  status: PostStatus.PUBLISHED,
  isHidden: false,
  author: new Types.ObjectId(),
});

function commentDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: new Types.ObjectId().toString(),
    post: POST_ID,
    author: new Types.ObjectId(user.id),
    body: 'Nice',
    isHidden: false,
    editedAt: undefined,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Thenable query stub so `await find(...).sort().skip().limit()` resolves to `rows`. */
function query<T>(rows: T) {
  const q: Record<string, unknown> = {};
  for (const m of ['sort', 'skip', 'limit']) q[m] = () => q;
  (q as { then: unknown }).then = (resolve: (value: T) => unknown) =>
    resolve(rows);
  return q;
}

function build(
  options: { post?: unknown; comment?: unknown; found?: unknown[] } = {},
) {
  const post = options.post === undefined ? publishedPost() : options.post;
  const posts = {
    findById: jest.fn().mockResolvedValue(post),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const comments = {
    create: jest.fn().mockResolvedValue(options.comment ?? commentDoc()),
    findById: jest.fn().mockResolvedValue(options.comment ?? commentDoc()),
    find: jest.fn().mockReturnValue(query(options.found ?? [])),
    countDocuments: jest.fn().mockResolvedValue((options.found ?? []).length),
  };
  const users = {
    findByIds: jest
      .fn()
      .mockResolvedValue([
        { id: user.id, name: 'Me', status: UserStatus.ACTIVE },
      ]),
  };
  const moderation = { deleteComment: jest.fn().mockResolvedValue(null) };
  const service = new CommentsService(
    posts as unknown as Model<Post>,
    comments as unknown as Model<Comment>,
    users as unknown as UsersService,
    moderation as unknown as BlogModerationService,
  );
  return { service, posts, comments, users, moderation };
}

describe('CommentsService.create (BLG-05)', () => {
  it('stores the comment and raises the post comment count', async () => {
    const { service, posts } = build();
    const view = await service.create(user, POST_ID.toString(), 'Nice');
    expect(view.body).toBe('Nice');
    // The count is incremented atomically, not recomputed.
    expect(posts.updateOne).toHaveBeenCalledWith(
      { _id: POST_ID },
      { $inc: { commentCount: 1 } },
    );
  });

  it('does not comment on an unpublished or missing post', async () => {
    const { service, posts } = build({ post: null });
    await expect(
      service.create(user, POST_ID.toString(), 'Nice'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(posts.updateOne).not.toHaveBeenCalled();
  });
});

describe('CommentsService.list (BLG-05, GEN-10)', () => {
  // A non-admin viewer must not receive hidden comments other than their own.
  it('filters hidden comments for a non-admin viewer', async () => {
    const { service, comments } = build({ found: [] });
    await service.list(POST_ID.toString(), { page: 1, limit: 10 }, user);
    const find = comments.find as unknown as jest.Mock<
      unknown,
      [Record<string, unknown>]
    >;
    expect(find.mock.calls[0][0].$or).toBeDefined();
  });

  it('does not filter for an admin', async () => {
    const admin: AuthUser = {
      id: new Types.ObjectId().toString(),
      role: Role.ADMIN,
    };
    const { service, comments } = build({ found: [] });
    await service.list(POST_ID.toString(), { page: 1, limit: 10 }, admin);
    const find = comments.find as unknown as jest.Mock<
      unknown,
      [Record<string, unknown>]
    >;
    expect(find.mock.calls[0][0].$or).toBeUndefined();
  });

  // A comment whose author deactivated their account shows as "Deleted user" with no id.
  it('shows a deactivated author as the deleted-user placeholder', async () => {
    const orphan = commentDoc({ author: new Types.ObjectId() });
    const { service, users } = build({ found: [orphan] });
    users.findByIds.mockResolvedValue([]); // the author is gone
    const page = await service.list(POST_ID.toString(), { page: 1, limit: 10 });
    expect(page.items[0].author).toEqual({ id: null, name: DELETED_USER });
  });
});

describe('CommentsService.update / remove (BLG-07)', () => {
  it('edits an own comment and stamps editedAt', async () => {
    const own = commentDoc();
    const { service } = build({ comment: own });
    await service.update(user, own.id, 'Edited');
    expect(own.body).toBe('Edited');
    expect(own.editedAt).toBeInstanceOf(Date);
    expect(own.save).toHaveBeenCalled();
  });

  it('refuses to edit a visible comment of another user (403), hidden one is 404', async () => {
    const stranger: AuthUser = {
      id: new Types.ObjectId().toString(),
      role: Role.USER,
    };
    const visible = build({ comment: commentDoc({ isHidden: false }) });
    await expect(
      visible.service.update(stranger, new Types.ObjectId().toString(), 'x'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const hidden = build({ comment: commentDoc({ isHidden: true }) });
    await expect(
      hidden.service.update(stranger, new Types.ObjectId().toString(), 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes an own comment through the shared cleanup', async () => {
    const own = commentDoc();
    const { service, moderation } = build({ comment: own });
    await service.remove(user, own.id);
    expect(moderation.deleteComment).toHaveBeenCalledWith(own.id);
  });
});

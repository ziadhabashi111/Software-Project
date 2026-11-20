import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../auth/auth.types';
import { loadPublishedPost } from './post-access';
import { Post, PostStatus } from './schemas/post.schema';

const AUTHOR = new Types.ObjectId();
const POST_ID = new Types.ObjectId().toString();

function post(overrides: Record<string, unknown> = {}) {
  return {
    _id: POST_ID,
    status: PostStatus.PUBLISHED,
    isHidden: false,
    author: AUTHOR,
    ...overrides,
  };
}

/** A raw posts mock plus the same object cast as a Model for the call. */
function build(found: unknown) {
  const posts = { findById: jest.fn().mockResolvedValue(found) };
  return { posts, model: posts as unknown as Model<Post> };
}

describe('loadPublishedPost (BLG-02, GEN-10)', () => {
  it('returns a published, visible post', async () => {
    const found = post();
    await expect(loadPublishedPost(build(found).model, POST_ID)).resolves.toBe(
      found,
    );
  });

  it('answers 404 for a malformed id without touching the database', async () => {
    const { posts, model } = build(post());
    await expect(loadPublishedPost(model, 'not-an-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(posts.findById).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing post', async () => {
    await expect(
      loadPublishedPost(build(null).model, POST_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // A draft must never leak through a public read, even to signed-in users.
  it('answers 404 for a draft', async () => {
    const { model } = build(post({ status: PostStatus.DRAFT }));
    await expect(
      loadPublishedPost(model, POST_ID, {
        id: AUTHOR.toString(),
        role: Role.USER,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // A hidden post (GEN-10) is 404 for a stranger, but its author and admins still see it.
  it('hides a hidden post from a stranger but not from its author or an admin', async () => {
    const hidden = post({ isHidden: true });
    const stranger = { id: new Types.ObjectId().toString(), role: Role.USER };
    await expect(
      loadPublishedPost(build(hidden).model, POST_ID, stranger),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      loadPublishedPost(build(hidden).model, POST_ID, {
        id: AUTHOR.toString(),
        role: Role.USER,
      }),
    ).resolves.toBe(hidden);
    await expect(
      loadPublishedPost(build(hidden).model, POST_ID, {
        id: new Types.ObjectId().toString(),
        role: Role.ADMIN,
      }),
    ).resolves.toBe(hidden);
  });
});

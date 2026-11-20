import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import type { UploadsService } from '../uploads/uploads.service';
import type { BlogModerationService } from './blog-moderation.service';
import { PostsService } from './posts.service';
import { Post, PostStatus } from './schemas/post.schema';

const author: AuthUser = {
  id: new Types.ObjectId().toString(),
  role: Role.USER,
};
const POST_ID = new Types.ObjectId();

/** A post document carrying `save` and the fields the view mapper reads. */
function postDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: POST_ID,
    id: POST_ID.toString(),
    author: new Types.ObjectId(author.id),
    title: 'Trip',
    body: 'Body',
    tags: [],
    images: [],
    status: PostStatus.DRAFT,
    isHidden: false,
    publishedAt: undefined,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    likeCount: 0,
    commentCount: 0,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function build(found: ReturnType<typeof postDoc> | null = postDoc()) {
  // create echoes its input back as a stored document, so we can assert what was saved.
  const created: { value?: Record<string, unknown> } = {};
  const posts = {
    create: jest.fn().mockImplementation((data: Record<string, unknown>) => {
      created.value = data;
      return Promise.resolve(postDoc(data));
    }),
    findById: jest.fn().mockResolvedValue(found),
  };
  const uploads = {
    isUploadedUrl: jest.fn().mockResolvedValue(true),
    saveImages: jest.fn(),
    remove: jest.fn().mockResolvedValue(true),
    assertCanAdd: jest.fn(),
  };
  const moderation = { deletePost: jest.fn().mockResolvedValue(null) };
  const service = new PostsService(
    posts as unknown as Model<Post>,
    uploads as unknown as UploadsService,
    moderation as unknown as BlogModerationService,
  );
  return { service, posts, uploads, moderation, created };
}

describe('PostsService.create (BLG-01, BLG-08)', () => {
  it('saves a draft by default, with no publish date', async () => {
    const { service, created } = build();
    await service.create(author, { title: 'Trip', body: 'Body' });
    expect(created.value).toMatchObject({ status: PostStatus.DRAFT });
    expect(created.value).not.toHaveProperty('publishedAt');
  });

  // Publishing on creation must stamp the publish date, since lists order by it.
  it('stamps a publish date when created already published', async () => {
    const { service, created } = build();
    await service.create(author, {
      title: 'Trip',
      body: 'Body',
      status: PostStatus.PUBLISHED,
    });
    expect(created.value).toHaveProperty('publishedAt');
    expect(created.value!.publishedAt).toBeInstanceOf(Date);
  });

  // GEN-08: you may only attach images you uploaded, or you could later delete someone else's file.
  it('rejects image URLs the author did not upload', async () => {
    const { service, uploads, posts } = build();
    uploads.isUploadedUrl.mockResolvedValue(false);
    await expect(
      service.create(author, {
        title: 'Trip',
        body: 'Body',
        imageUrls: ['/uploads/someone-else.jpg'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(posts.create).not.toHaveBeenCalled();
  });
});

describe('PostsService.update (BLG-04, BLG-08)', () => {
  it('applies only the fields sent and saves', async () => {
    const doc = postDoc();
    const { service } = build(doc);
    await service.update(author, POST_ID.toString(), { title: 'New' });
    expect(doc.title).toBe('New');
    expect(doc.body).toBe('Body'); // untouched
    expect(doc.save).toHaveBeenCalled();
  });

  // The publish date is set the first time only, so re-publishing keeps the original date.
  it('sets the publish date the first time it is published, and keeps it afterwards', async () => {
    const first = postDoc();
    const svc1 = build(first);
    await svc1.service.update(author, POST_ID.toString(), {
      status: PostStatus.PUBLISHED,
    });
    expect(first.publishedAt).toBeInstanceOf(Date);

    const original = new Date('2026-01-05T00:00:00Z');
    const republished = postDoc({
      publishedAt: original,
      status: PostStatus.DRAFT,
    });
    const svc2 = build(republished);
    await svc2.service.update(author, POST_ID.toString(), {
      status: PostStatus.PUBLISHED,
    });
    expect(republished.publishedAt).toBe(original);
  });

  it('answers 404 for someone else’s draft and 403 for their published post', async () => {
    const stranger: AuthUser = {
      id: new Types.ObjectId().toString(),
      role: Role.USER,
    };
    const draft = build(postDoc({ status: PostStatus.DRAFT }));
    await expect(
      draft.service.update(stranger, POST_ID.toString(), { title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const published = build(
      postDoc({ status: PostStatus.PUBLISHED, isHidden: false }),
    );
    await expect(
      published.service.update(stranger, POST_ID.toString(), { title: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('PostsService.remove (BLG-04)', () => {
  it('delegates to the shared delete so comments, likes and files are cleaned up', async () => {
    const { service, moderation } = build();
    await service.remove(author, POST_ID.toString());
    expect(moderation.deletePost).toHaveBeenCalledWith(POST_ID.toString());
  });
});

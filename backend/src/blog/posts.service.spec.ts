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
import { AuthorItineraries } from './author-itineraries';
import type { LinkedItinerary } from './author-itineraries';
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
    itinerary: undefined as Types.ObjectId | undefined,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    likeCount: 0,
    commentCount: 0,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function build(
  found: ReturnType<typeof postDoc> | null = postDoc(),
  linked: LinkedItinerary | null = null,
) {
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
    attach: jest.fn().mockResolvedValue(undefined),
    detach: jest.fn().mockResolvedValue(undefined),
    saveImages: jest.fn(),
    remove: jest.fn().mockResolvedValue(true),
    assertCanAdd: jest.fn(),
  };
  const moderation = { deletePost: jest.fn().mockResolvedValue(null) };
  // The itinerary module's side of BLG-13, answering for the one itinerary.
  const authors = new AuthorItineraries();
  const ownedBy = jest.fn().mockResolvedValue(linked);
  authors.register({
    publicForAuthor: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    ownedBy,
    publicSummary: jest.fn().mockResolvedValue(null),
  });
  const service = new PostsService(
    posts as unknown as Model<Post>,
    uploads as unknown as UploadsService,
    moderation as unknown as BlogModerationService,
    authors,
  );
  return { service, posts, uploads, moderation, created, ownedBy };
}

const ITINERARY_ID = new Types.ObjectId().toString();
const LINKED: LinkedItinerary = {
  id: ITINERARY_ID,
  title: 'A week in Egypt',
  countries: ['EG'],
  startDate: '2027-03-01',
  dayCount: 7,
  isPublic: true,
};

describe('PostsService.setItinerary (BLG-13)', () => {
  it("links the author's own public itinerary to the post", async () => {
    const post = postDoc();
    const { service, ownedBy } = build(post, LINKED);
    const view = await service.setItinerary(author, POST_ID.toString(), {
      itineraryId: ITINERARY_ID,
    });
    expect(ownedBy).toHaveBeenCalledWith(author.id, ITINERARY_ID);
    expect(String(post.itinerary)).toBe(ITINERARY_ID);
    expect(post.save).toHaveBeenCalled();
    expect(view.itinerary).toEqual(LINKED);
  });

  it('unlinks with null and keeps the rest of the post', async () => {
    const post = postDoc({ itinerary: new Types.ObjectId(ITINERARY_ID) });
    const { service, ownedBy } = build(post, LINKED);
    const view = await service.setItinerary(author, POST_ID.toString(), {
      itineraryId: null,
    });
    expect(post.itinerary).toBeUndefined();
    expect(post.save).toHaveBeenCalled();
    expect(view.itinerary).toBeNull();
    expect(ownedBy).not.toHaveBeenCalled();
  });

  // Someone else's itinerary must not be linkable, nor even confirmed to exist.
  it("answers 404 for an itinerary that is not the author's or does not exist", async () => {
    const post = postDoc();
    const { service } = build(post, null);
    await expect(
      service.setItinerary(author, POST_ID.toString(), {
        itineraryId: ITINERARY_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(post.save).not.toHaveBeenCalled();
  });

  it('refuses an itinerary that is not public, with a field error', async () => {
    const post = postDoc();
    const { service } = build(post, { ...LINKED, isPublic: false });
    const error: unknown = await service
      .setItinerary(author, POST_ID.toString(), { itineraryId: ITINERARY_ID })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(
      JSON.stringify((error as BadRequestException).getResponse()),
    ).toContain('itineraryId');
    expect(post.save).not.toHaveBeenCalled();
  });

  it("is only for the post's author (403 for a published post, 404 for a draft)", async () => {
    const stranger: AuthUser = {
      id: new Types.ObjectId().toString(),
      role: Role.USER,
    };
    const published = postDoc({ status: PostStatus.PUBLISHED });
    await expect(
      build(published, LINKED).service.setItinerary(
        stranger,
        POST_ID.toString(),
        { itineraryId: ITINERARY_ID },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      build(postDoc(), LINKED).service.setItinerary(
        stranger,
        POST_ID.toString(),
        { itineraryId: ITINERARY_ID },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(published.save).not.toHaveBeenCalled();
  });
});

describe("PostsService views show the author's linked itinerary (BLG-13)", () => {
  it('shows it, with whether it is public right now', async () => {
    const post = postDoc({ itinerary: new Types.ObjectId(ITINERARY_ID) });
    const { service, ownedBy } = build(post, { ...LINKED, isPublic: false });
    const view = await service.getOwn(author, POST_ID.toString());
    expect(ownedBy).toHaveBeenCalledWith(author.id, ITINERARY_ID);
    expect(view.itinerary).toEqual({ ...LINKED, isPublic: false });
  });

  it('shows none when the post has no link, without asking the itinerary module', async () => {
    const { service, ownedBy } = build(postDoc(), LINKED);
    const view = await service.getOwn(author, POST_ID.toString());
    expect(view.itinerary).toBeNull();
    expect(ownedBy).not.toHaveBeenCalled();
  });

  it('shows none once the itinerary has been deleted', async () => {
    const post = postDoc({ itinerary: new Types.ObjectId(ITINERARY_ID) });
    const { service } = build(post, null);
    expect(
      (await service.getOwn(author, POST_ID.toString())).itinerary,
    ).toBeNull();
  });

  it('also shows it on a freshly edited post', async () => {
    const post = postDoc({ itinerary: new Types.ObjectId(ITINERARY_ID) });
    const { service } = build(post, LINKED);
    const view = await service.update(author, POST_ID.toString(), {
      title: 'New title',
    });
    expect(view.itinerary).toEqual(LINKED);
  });
});

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
  it('rejects image URLs the author did not upload, or that another post uses', async () => {
    const { service, uploads, posts } = build();
    uploads.attach.mockRejectedValue(new BadRequestException('not yours'));
    await expect(
      service.create(author, {
        title: 'Trip',
        body: 'Body',
        imageUrls: ['/uploads/someone-else.jpg'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(posts.create).not.toHaveBeenCalled();
  });

  it('frees the claimed images when saving the post fails', async () => {
    const { service, uploads, posts } = build();
    posts.create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.create(author, {
        title: 'Trip',
        body: 'Body',
        imageUrls: ['http://localhost:3000/uploads/a.png'],
      }),
    ).rejects.toThrow('db down');
    expect(uploads.detach).toHaveBeenCalledWith([
      'http://localhost:3000/uploads/a.png',
    ]);
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

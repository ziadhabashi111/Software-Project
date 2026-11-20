import { Types } from 'mongoose';
import { PostStatus } from './schemas/post.schema';
import type { PostDocument } from './schemas/post.schema';
import {
  EXCERPT_LENGTH,
  excerptOf,
  postDate,
  toMyPostRow,
  toPostView,
  toPublicPostRow,
} from './post-view';

/** Minimal stand-in for a hydrated post document (only the fields the mappers read). */
function postDoc(
  overrides: Partial<Record<string, unknown>> = {},
): PostDocument {
  const imageId = new Types.ObjectId();
  return {
    id: 'post1',
    title: 'My trip',
    body: 'A great trip to Cairo.',
    tags: ['egypt'],
    images: [{ _id: imageId, url: '/uploads/a.jpg' }],
    status: PostStatus.PUBLISHED,
    isHidden: false,
    publishedAt: new Date('2026-01-02T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-03T00:00:00Z'),
    likeCount: 2,
    commentCount: 1,
    author: new Types.ObjectId(),
    ...overrides,
  } as unknown as PostDocument;
}

describe('excerptOf (BLG-02)', () => {
  it('collapses whitespace and keeps short bodies whole', () => {
    expect(excerptOf('  hello\n\n  world  ')).toBe('hello world');
  });

  // Boundary: a body of exactly the limit is kept in full, one over is cut.
  it('keeps a body at the length limit but truncates one character longer', () => {
    const exact = 'a'.repeat(EXCERPT_LENGTH);
    expect(excerptOf(exact)).toBe(exact);

    const long = 'a'.repeat(EXCERPT_LENGTH + 1);
    const cut = excerptOf(long);
    expect(cut.endsWith('…')).toBe(true);
    expect([...cut]).toHaveLength(EXCERPT_LENGTH); // 199 chars + the ellipsis
  });

  it('handles an empty body', () => {
    expect(excerptOf('')).toBe('');
  });
});

describe('postDate', () => {
  it('uses the publish date when published', () => {
    expect(postDate(postDoc())).toEqual(new Date('2026-01-02T00:00:00Z'));
  });

  // A draft has no publishedAt, so lists and pages fall back to the creation date.
  it('falls back to the creation date for a draft', () => {
    const draft = postDoc({ publishedAt: undefined, status: PostStatus.DRAFT });
    expect(postDate(draft)).toEqual(new Date('2026-01-01T00:00:00Z'));
  });
});

describe('toPostView', () => {
  it('maps every field and turns image ids into strings', () => {
    const view = toPostView(postDoc());
    expect(view).toMatchObject({
      id: 'post1',
      title: 'My trip',
      status: PostStatus.PUBLISHED,
      publishedAt: new Date('2026-01-02T00:00:00Z'),
      likeCount: 2,
      commentCount: 1,
    });
    expect(view.images[0].id).toEqual(expect.any(String));
    expect(view.images[0].url).toBe('/uploads/a.jpg');
  });

  it('reports publishedAt as null for a draft', () => {
    expect(
      toPostView(postDoc({ publishedAt: undefined })).publishedAt,
    ).toBeNull();
  });
});

describe('toMyPostRow / toPublicPostRow', () => {
  it('the author row drops the body but keeps status and counts', () => {
    const row = toMyPostRow(postDoc());
    expect(row).not.toHaveProperty('body');
    expect(row).toMatchObject({ status: PostStatus.PUBLISHED, likeCount: 2 });
  });

  it('the public row carries the author name and an excerpt instead of the body', () => {
    const row = toPublicPostRow(postDoc(), 'Sara');
    expect(row.author.name).toBe('Sara');
    expect(row.excerpt).toBe('A great trip to Cairo.');
    expect(row).not.toHaveProperty('body');
  });
});

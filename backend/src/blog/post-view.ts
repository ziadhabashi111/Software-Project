import type { PostDocument, PostStatus } from './schemas/post.schema';

export const EXCERPT_LENGTH = 200;

/** The full post, as its author sees it. */
export interface PostView {
  id: string;
  title: string;
  body: string;
  tags: string[];
  images: { id: string; url: string }[];
  status: PostStatus;
  isHidden: boolean;
  /** Publish date, or the creation date for drafts. */
  date: Date;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  likeCount: number;
  commentCount: number;
}

/** A row of `GET /api/posts/mine` (BLG-03). */
export interface MyPostRow {
  id: string;
  title: string;
  status: PostStatus;
  isHidden: boolean;
  date: Date;
  tags: string[];
  likeCount: number;
  commentCount: number;
}

/** A row of a public list such as `GET /api/tags/:tag/posts`. */
export interface PublicPostRow {
  id: string;
  title: string;
  author: { id: string; name: string };
  date: Date;
  excerpt: string;
  tags: string[];
  likeCount: number;
  commentCount: number;
}

export const postDate = (post: PostDocument): Date =>
  post.publishedAt ?? post.createdAt;

export function excerptOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= EXCERPT_LENGTH
    ? flat
    : `${flat.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`;
}

export function toPostView(post: PostDocument): PostView {
  return {
    id: post.id,
    title: post.title,
    body: post.body,
    tags: post.tags,
    images: post.images.map((image) => ({
      id: image._id.toString(),
      url: image.url,
    })),
    status: post.status,
    isHidden: post.isHidden,
    date: postDate(post),
    publishedAt: post.publishedAt ?? null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
  };
}

export function toMyPostRow(post: PostDocument): MyPostRow {
  return {
    id: post.id,
    title: post.title,
    status: post.status,
    isHidden: post.isHidden,
    date: postDate(post),
    tags: post.tags,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
  };
}

export function toPublicPostRow(
  post: PostDocument,
  authorName: string,
): PublicPostRow {
  return {
    id: post.id,
    title: post.title,
    author: { id: post.author.toString(), name: authorName },
    date: postDate(post),
    excerpt: excerptOf(post.body),
    tags: post.tags,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
  };
}

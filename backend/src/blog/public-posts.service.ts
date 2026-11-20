import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Model, Types } from 'mongoose';
import type { PipelineStage, QueryFilter } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import {
  DEFAULT_PAGE_SIZE,
  Paginated,
  skipFor,
  toPage,
} from '../common/pagination/pagination';
import { canViewContent } from '../common/security/content-visibility';
import { User } from '../users/schemas/user.schema';
import { UserStatus } from '../users/user-status';
import { UsersService } from '../users/users.service';
import {
  AuthorItineraries,
  type PublicItinerarySummary,
} from './author-itineraries';
import { CommentsService, type CommentView } from './comments.service';
import { ListCommentsQueryDto } from './dto/comment.dto';
import { LikesService } from './likes.service';
import { excerptOf, type PublicPostRow } from './post-view';
import { Post, PostStatus } from './schemas/post.schema';

/** The public post page (BLG-02). */
export interface PublicPostView {
  id: string;
  title: string;
  author: { id: string; name: string };
  date: Date;
  body: string;
  tags: string[];
  images: { id: string; url: string }[];
  likeCount: number;
  commentCount: number;
  /** draft or published: a draft is only ever shown to its author. */
  status: PostStatus;
  isHidden: boolean;
  /** Whether the signed-in viewer likes it; null for guests. */
  likedByMe: boolean | null;
  /** First page of comments, oldest first (more: GET /api/posts/:id/comments). */
  comments: Paginated<CommentView>;
  /**
   * BLG-13: summary of the author's itinerary this post links to, only while
   * that itinerary is public and visible; otherwise null.
   */
  itinerary: PublicItinerarySummary | null;
}

/** The public author page (BLG-12). */
export interface AuthorPageView {
  id: string;
  name: string;
  joinedAt: Date;
  posts: Paginated<PublicPostRow>;
  itineraries: Paginated<PublicItinerarySummary>;
}

/** A post as the aggregation returns it, with the author's name joined in. */
interface PostRow {
  _id: Types.ObjectId;
  title: string;
  body: string;
  tags: string[];
  author: Types.ObjectId;
  publishedAt?: Date;
  createdAt: Date;
  likeCount: number;
  commentCount: number;
  authorDoc: { name: string };
}

const escapeRegex = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const NEWEST_FIRST = { publishedAt: -1, _id: -1 } as const;
/** BLG-09: interaction score (likes + comments) desc, newest first on ties. */
const MOST_INTERACTION = { score: -1, publishedAt: -1, _id: -1 } as const;

const AUTHOR_ITINERARIES_PAGE_SIZE = DEFAULT_PAGE_SIZE;

/**
 * BLG-02 (browse, post page), BLG-08 (tag page), BLG-09 (search) and BLG-12
 * (author page): everything guests can read.
 *
 * Public lists show published, not hidden posts whose author is not
 * deactivated (ACC-12). They come from one aggregation that joins only the
 * author's name and status, so filtering by author name, sorting by
 * interaction score and pagination happen together in MongoDB.
 */
@Injectable()
export class PublicPostsService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectConnection() private readonly connection: Connection,
    private readonly users: UsersService,
    private readonly comments: CommentsService,
    private readonly likes: LikesService,
    private readonly authorItineraries: AuthorItineraries,
  ) {}

  /** BLG-02: published posts, newest first, optionally with one tag. */
  browse(
    query: { page: number; limit: number },
    tag?: string,
  ): Promise<Paginated<PublicPostRow>> {
    return this.publicPage(tag ? { tags: tag } : {}, NEWEST_FIRST, query);
  }

  /** BLG-09: keyword in title, tags or author name; most interaction first. */
  search(
    keyword: string,
    query: { page: number; limit: number },
  ): Promise<Paginated<PublicPostRow>> {
    return this.publicPage({}, MOST_INTERACTION, query, keyword);
  }

  /**
   * BLG-02: the post page. Drafts only for their author; hidden posts only
   * for the author and admins (GEN-10); posts of deactivated authors are
   * gone for everyone else (ACC-12). Anything not visible answers 404.
   */
  async getPost(id: string, viewer?: AuthUser): Promise<PublicPostView> {
    const post = isValidObjectId(id) ? await this.posts.findById(id) : null;
    if (!post) throw new NotFoundException('Post not found');

    const isAuthor = viewer?.id === post.author.toString();
    const isAdmin = viewer?.role === Role.ADMIN;
    const author = await this.users.findById(post.author.toString());
    const authorGone = !author || author.status === UserStatus.DEACTIVATED;
    const visible =
      (post.status === PostStatus.PUBLISHED || isAuthor) &&
      canViewContent(
        { isHidden: post.isHidden, authorId: post.author },
        viewer,
      ) &&
      (!authorGone || isAuthor || isAdmin);
    if (!visible) throw new NotFoundException('Post not found');

    const published = post.status === PostStatus.PUBLISHED;
    const firstPage = new ListCommentsQueryDto();
    const [comments, liked, itinerary] = await Promise.all([
      published
        ? this.comments.list(post.id, firstPage, viewer)
        : Promise.resolve(toPage<CommentView>([], 0, firstPage)),
      viewer ? this.likes.likedBy(viewer.id, [post._id]) : null,
      post.itinerary
        ? this.authorItineraries.publicSummary(post.itinerary.toString())
        : null,
    ]);

    return {
      id: post.id,
      title: post.title,
      author: {
        id: post.author.toString(),
        name: authorGone ? 'Deleted user' : author.name,
      },
      date: post.publishedAt ?? post.createdAt,
      body: post.body,
      tags: post.tags,
      images: post.images.map((image) => ({
        id: image._id.toString(),
        url: image.url,
      })),
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      status: post.status,
      isHidden: post.isHidden,
      likedByMe: liked ? liked.has(post.id) : null,
      comments,
      itinerary,
    };
  }

  /**
   * BLG-12: name, join date, published posts (paginated, newest first) and
   * public itineraries. Deactivated authors have no page (ACC-12).
   */
  async authorPage(
    authorId: string,
    query: { page: number; limit: number; itinerariesPage?: number },
  ): Promise<AuthorPageView> {
    const author = isValidObjectId(authorId)
      ? await this.users.findById(authorId)
      : null;
    if (!author || author.status === UserStatus.DEACTIVATED) {
      throw new NotFoundException('Author not found');
    }
    const itineraryPage = {
      page: query.itinerariesPage ?? 1,
      limit: AUTHOR_ITINERARIES_PAGE_SIZE,
    };
    const [posts, found] = await Promise.all([
      this.publicPage(
        { author: new Types.ObjectId(authorId) },
        NEWEST_FIRST,
        query,
      ),
      this.authorItineraries.publicForAuthor(authorId, {
        skip: skipFor(itineraryPage),
        limit: itineraryPage.limit,
      }),
    ]);
    return {
      id: author.id,
      name: author.name,
      joinedAt: author.createdAt,
      posts,
      itineraries: toPage(found.items, found.total, itineraryPage),
    };
  }

  private async publicPage(
    match: QueryFilter<Post>,
    sort: Record<string, 1 | -1>,
    query: { page: number; limit: number },
    keyword?: string,
  ): Promise<Paginated<PublicPostRow>> {
    const pattern = keyword ? new RegExp(escapeRegex(keyword), 'i') : null;
    const pipeline: PipelineStage[] = [
      {
        $match: {
          status: PostStatus.PUBLISHED,
          isHidden: { $ne: true },
          ...match,
        },
      },
      {
        $lookup: {
          from: this.usersCollection(),
          localField: 'author',
          foreignField: '_id',
          as: 'authorDoc',
          pipeline: [{ $project: { name: 1, status: 1 } }],
        },
      },
      { $unwind: '$authorDoc' },
      { $match: { 'authorDoc.status': { $ne: UserStatus.DEACTIVATED } } },
      ...(pattern
        ? [
            {
              $match: {
                $or: [
                  { title: pattern },
                  { tags: pattern },
                  { 'authorDoc.name': pattern },
                ],
              },
            },
          ]
        : []),
      { $addFields: { score: { $add: ['$likeCount', '$commentCount'] } } },
      {
        $facet: {
          items: [
            { $sort: sort },
            { $skip: skipFor(query) },
            { $limit: query.limit },
          ],
          total: [{ $count: 'n' }],
        },
      },
    ];
    const [result] = await this.posts.aggregate<{
      items: PostRow[];
      total: { n: number }[];
    }>(pipeline);
    const items = (result?.items ?? []).map((row): PublicPostRow => ({
      id: row._id.toString(),
      title: row.title,
      author: { id: row.author.toString(), name: row.authorDoc.name },
      date: row.publishedAt ?? row.createdAt,
      excerpt: excerptOf(row.body),
      tags: row.tags,
      likeCount: row.likeCount,
      commentCount: row.commentCount,
    }));
    return toPage(items, result?.total[0]?.n ?? 0, query);
  }

  private usersCollection(): string {
    return this.connection.model(User.name).collection.collectionName;
  }
}

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import type { QueryFilter } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
import { fieldError } from '../common/validation/validation-errors';
import type { ImageFile } from '../uploads/uploads.service';
import { UploadsService } from '../uploads/uploads.service';
import { UsersService } from '../users/users.service';
import { BlogModerationService } from './blog-moderation.service';
import {
  IMAGES_MAX,
  type CreatePostDto,
  type ListMyPostsQueryDto,
  type ListTagPostsQueryDto,
  type UpdatePostDto,
} from './dto/post.dto';
import {
  toMyPostRow,
  toPostView,
  toPublicPostRow,
  type MyPostRow,
  type PostView,
  type PublicPostRow,
} from './post-view';
import { Post, PostStatus } from './schemas/post.schema';
import type { PostDocument } from './schemas/post.schema';

/** Shown instead of the name of an account that no longer exists. */
export const UNKNOWN_AUTHOR = 'Deleted user';

/** Published, not hidden: what guests and other users may see (BLG-02). */
export const PUBLIC_POSTS: QueryFilter<Post> = {
  status: PostStatus.PUBLISHED,
  isHidden: { $ne: true },
};

/**
 * BLG-01, 03, 04, 08, 10: an author's own posts (create, list, edit, delete,
 * tags, images) and the public tag page.
 */
@Injectable()
export class PostsService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    private readonly uploads: UploadsService,
    private readonly users: UsersService,
    private readonly moderation: BlogModerationService,
  ) {}

  /** BLG-01: title and body required; tags and images optional; draft by default. */
  async create(author: AuthUser, dto: CreatePostDto): Promise<PostView> {
    const imageUrls = dto.imageUrls ?? [];
    await this.assertOwnImageUrls(author.id, imageUrls);
    const status = dto.status ?? PostStatus.DRAFT;
    const post = await this.posts.create({
      author: new Types.ObjectId(author.id),
      title: dto.title,
      body: dto.body,
      tags: dto.tags ?? [],
      images: imageUrls.map((url) => ({ url })),
      status,
      ...(status === PostStatus.PUBLISHED ? { publishedAt: new Date() } : {}),
    });
    return toPostView(post);
  }

  /** BLG-03: the author's posts including drafts, newest first. */
  async listMine(
    author: AuthUser,
    query: ListMyPostsQueryDto,
  ): Promise<Paginated<MyPostRow>> {
    const filter: QueryFilter<Post> = {
      author: new Types.ObjectId(author.id),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.posts
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skipFor(query))
        .limit(query.limit),
      this.posts.countDocuments(filter),
    ]);
    return toPage(items.map(toMyPostRow), total, query);
  }

  /** The author's own post with everything (body, images) for the editor. */
  async getOwn(author: AuthUser, id: string): Promise<PostView> {
    return toPostView(await this.loadOwn(author, id));
  }

  /**
   * BLG-04, BLG-08: the author edits title, body, tags or status. Publishing
   * for the first time sets the publish date; moving back to draft keeps it.
   */
  async update(
    author: AuthUser,
    id: string,
    dto: UpdatePostDto,
  ): Promise<PostView> {
    const post = await this.loadOwn(author, id);
    if (dto.imageUrls !== undefined) {
      throw fieldError(
        'imageUrls',
        'Add or remove images with the post image endpoints',
      );
    }
    if (dto.title !== undefined) post.title = dto.title;
    if (dto.body !== undefined) post.body = dto.body;
    if (dto.tags !== undefined) post.tags = dto.tags;
    if (dto.status !== undefined) {
      post.status = dto.status;
      if (dto.status === PostStatus.PUBLISHED && !post.publishedAt) {
        post.publishedAt = new Date();
      }
    }
    await post.save();
    return toPostView(post);
  }

  /** BLG-04: deletes the post, its comments and its image files. */
  async remove(author: AuthUser, id: string): Promise<void> {
    const post = await this.loadOwn(author, id);
    await this.moderation.deletePost(post.id);
    await Promise.all(
      post.images.map((image) => this.uploads.remove(image.url, author.id)),
    );
  }

  /**
   * BLG-10: attaches up to 5 images in total (GEN-08). The count check and
   * the update are one atomic step, so parallel uploads cannot pass 5.
   */
  async addImages(
    author: AuthUser,
    id: string,
    files: ImageFile[] | undefined,
  ): Promise<PostView> {
    const post = await this.loadOwn(author, id);
    const stored = await this.uploads.saveImages(
      files,
      'post',
      author.id,
      post.images.length,
    );
    const room = IMAGES_MAX - stored.length; // index that must still be free
    const updated = await this.posts.findOneAndUpdate(
      { _id: post._id, [`images.${room}`]: { $exists: false } },
      {
        $push: {
          images: { $each: stored.map((image) => ({ url: image.url })) },
        },
      },
      { returnDocument: 'after' },
    );
    if (!updated) {
      // Another upload filled the post first (or it was deleted meanwhile).
      await Promise.all(
        stored.map((image) => this.uploads.remove(image.url, author.id)),
      );
      const current = await this.posts.findById(post._id);
      if (!current) throw new NotFoundException('Post not found');
      this.uploads.assertCanAdd('post', current.images.length, stored.length);
      throw new NotFoundException('Post not found'); // not reached
    }
    return toPostView(updated);
  }

  /** BLG-10: removes one image from the post and deletes its file. */
  async removeImage(
    author: AuthUser,
    id: string,
    imageId: string,
  ): Promise<PostView> {
    const post = await this.loadOwn(author, id);
    const image = isValidObjectId(imageId)
      ? post.images.find((item) => item._id.toString() === imageId)
      : undefined;
    if (!image) throw new NotFoundException('Image not found');

    const updated = await this.posts.findOneAndUpdate(
      { _id: post._id },
      { $pull: { images: { _id: image._id } } },
      { returnDocument: 'after' },
    );
    await this.uploads.remove(image.url, author.id);
    if (!updated) throw new NotFoundException('Post not found');
    return toPostView(updated);
  }

  /** BLG-08: published, visible posts with this tag, newest first. */
  async listByTag(
    tag: string,
    query: ListTagPostsQueryDto,
  ): Promise<Paginated<PublicPostRow>> {
    const filter: QueryFilter<Post> = {
      ...PUBLIC_POSTS,
      tags: tag.trim().toLowerCase(),
    };
    const [items, total] = await Promise.all([
      this.posts
        .find(filter)
        .sort({ publishedAt: -1, _id: -1 })
        .skip(skipFor(query))
        .limit(query.limit),
      this.posts.countDocuments(filter),
    ]);
    return toPage(await this.withAuthors(items), total, query);
  }

  private async withAuthors(posts: PostDocument[]): Promise<PublicPostRow[]> {
    const authors = await this.users.findByIds([
      ...new Set(posts.map((post) => post.author.toString())),
    ]);
    const names = new Map(authors.map((user) => [user.id, user.name]));
    return posts.map((post) =>
      toPublicPostRow(
        post,
        names.get(post.author.toString()) ?? UNKNOWN_AUTHOR,
      ),
    );
  }

  /**
   * Loads a post its author wants to change. Others get 403 when they could
   * see the post anyway (published, visible) and 404 otherwise, so drafts and
   * hidden posts are never revealed.
   */
  private async loadOwn(author: AuthUser, id: string): Promise<PostDocument> {
    const post = isValidObjectId(id) ? await this.posts.findById(id) : null;
    if (!post) throw new NotFoundException('Post not found');
    if (post.author.toString() !== author.id) {
      if (post.status === PostStatus.PUBLISHED && !post.isHidden) {
        throw new ForbiddenException('Only the author can change this post');
      }
      throw new NotFoundException('Post not found');
    }
    return post;
  }

  /** GEN-08: only images this author uploaded can be attached to their post. */
  private async assertOwnImageUrls(
    ownerId: string,
    urls: string[],
  ): Promise<void> {
    await Promise.all(
      urls.map((url) =>
        this.uploads.assertOwnedUpload(url, ownerId, 'imageUrls'),
      ),
    );
  }
}

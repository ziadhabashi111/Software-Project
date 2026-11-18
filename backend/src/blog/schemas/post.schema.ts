import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type PostDocument = HydratedDocument<Post>;

export enum PostStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

/** An image attached to a post through the upload helper (BLG-10, GEN-08). */
@Schema()
export class PostImage {
  _id!: Types.ObjectId;

  @Prop({ type: String, required: true })
  url!: string;
}
const PostImageSchema = SchemaFactory.createForClass(PostImage);

/**
 * A blog post (BLG-01). Drafts are visible only to the author; a hidden post
 * (GEN-10) only to the author and admins.
 */
@Schema({ collection: 'posts', timestamps: true })
export class Post {
  _id!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  author!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  title!: string;

  @Prop({ type: String, required: true })
  body!: string;

  /** Up to 5 tags of at most 30 characters (BLG-08), stored lower-case. */
  @Prop({ type: [String], default: [], index: true })
  tags!: string[];

  @Prop({ type: [PostImageSchema], default: [] })
  images!: PostImage[];

  @Prop({
    type: String,
    enum: Object.values(PostStatus),
    default: PostStatus.DRAFT,
  })
  status!: PostStatus;

  /** Set when first published; the date shown on the post. */
  @Prop({ type: Date })
  publishedAt?: Date;

  /** Set by an admin (GEN-10): visible only to the author and admins. */
  @Prop({ type: Boolean, default: false })
  isHidden!: boolean;

  @Prop({ type: Number, default: 0, min: 0 })
  likeCount!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  commentCount!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PostSchema = SchemaFactory.createForClass(Post);
PostSchema.index({ status: 1, isHidden: 1, publishedAt: -1 });

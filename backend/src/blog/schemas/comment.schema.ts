import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type CommentDocument = HydratedDocument<Comment>;

/**
 * A comment on a published post (BLG-05): non-empty, at most 500 characters,
 * shown in chronological order. Hidden comments (GEN-10) are visible only to
 * their author and admins.
 */
@Schema({ collection: 'comments', timestamps: true })
export class Comment {
  _id!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Post', required: true })
  post!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  author!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 500 })
  body!: string;

  @Prop({ type: Boolean, default: false })
  isHidden!: boolean;

  /** Set when the author edits the comment (BLG-07). */
  @Prop({ type: Date })
  editedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);
CommentSchema.index({ post: 1, createdAt: 1 });

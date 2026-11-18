import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type LikeDocument = HydratedDocument<Like>;

/**
 * BLG-06: one user's like of one post. The unique index makes "at most one
 * like per user per post" a database rule, so parallel requests cannot
 * double-count. The post's `likeCount` is kept in step with these documents.
 */
@Schema({
  collection: 'likes',
  timestamps: { createdAt: true, updatedAt: false },
})
export class Like {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Post', required: true })
  post!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  createdAt!: Date;
}

export const LikeSchema = SchemaFactory.createForClass(Like);
LikeSchema.index({ post: 1, user: 1 }, { unique: true });

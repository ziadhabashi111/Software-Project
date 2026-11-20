import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { IMAGE_LIMITS, type ImageOwnerKind } from './image-rules';

export type UploadDocument = HydratedDocument<Upload>;

/**
 * GEN-08: who stored each uploaded file. The helper only lets that user reuse
 * the URL (`assertOwnedUpload`) or delete the file (`remove`), so one
 * provider cannot claim or delete another provider's image.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Upload {
  /** The stored file name (`<uuid>.<jpg|png>`); also the image id. */
  @Prop({ type: String, required: true, unique: true })
  filename!: string;

  @Prop({ type: String, required: true })
  url!: string;

  /** The signed-in user who uploaded the file. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  ownerId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.keys(IMAGE_LIMITS) })
  kind!: ImageOwnerKind;

  /**
   * True for files from the stand-alone `POST /api/uploads/images`: they are
   * attached to an item later (`UploadsService.attach`), and removed by the
   * cleanup job when that never happens.
   */
  @Prop({ type: Boolean, default: false })
  standalone!: boolean;

  /**
   * When the file was attached to its post, activity, hotel or airline. Files
   * saved straight onto an item are attached at once. A file is attached to
   * one item only, so deleting that item can safely delete the file.
   */
  @Prop({ type: Date })
  attachedAt?: Date;

  createdAt?: Date;
}

export const UploadSchema = SchemaFactory.createForClass(Upload);

// GEN-08: the hourly cleanup finds unattached stand-alone uploads by age.
UploadSchema.index(
  { createdAt: 1 },
  { partialFilterExpression: { standalone: true } },
);

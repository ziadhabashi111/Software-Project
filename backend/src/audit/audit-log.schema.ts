import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { AuditAction } from './audit-action';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  /** The admin who performed the action. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  actor!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(AuditAction), required: true })
  action!: AuditAction;

  /** What was acted on, e.g. user, hotel, airline, post, comment, review. */
  @Prop({ type: String, required: true })
  targetType!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  targetId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.Mixed })
  details?: Record<string, unknown>;

  createdAt!: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ actor: 1, createdAt: -1 });

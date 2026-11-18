import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ContentType } from '../../admin/content-moderators';
import { ReportAction } from '../../admin/report-source';

export type ReportDocument = HydratedDocument<Report>;

export enum ReportStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
}

export const REPORT_REASON_MAX = 500;

/** How an administrator closed the report (GEN-10). */
@Schema({ _id: false })
export class ReportResolution {
  @Prop({ type: String, enum: Object.values(ReportAction), required: true })
  action!: ReportAction;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  admin!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  resolvedAt!: Date;
}
const ReportResolutionSchema = SchemaFactory.createForClass(ReportResolution);

/**
 * GEN-09: a registered user's report of a post, comment, review or itinerary.
 * A user can report the same item at most once (unique index below).
 * Administrators read and resolve reports through `ReportSource` (GEN-10).
 */
@Schema({ collection: 'reports', timestamps: true })
export class Report {
  _id!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(ContentType), required: true })
  contentType!: ContentType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  contentId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  reporter!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: REPORT_REASON_MAX,
  })
  reason!: string;

  @Prop({
    type: String,
    enum: Object.values(ReportStatus),
    default: ReportStatus.OPEN,
  })
  status!: ReportStatus;

  @Prop({ type: ReportResolutionSchema })
  resolution?: ReportResolution;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ReportSchema = SchemaFactory.createForClass(Report);
/** At most one report per user per item (GEN-09), enforced by MongoDB. */
ReportSchema.index(
  { reporter: 1, contentType: 1, contentId: 1 },
  { unique: true },
);
/** The admin's open-report list, newest first. */
ReportSchema.index({ status: 1, createdAt: -1 });

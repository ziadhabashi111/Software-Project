import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import { BlogModerationService } from './blog-moderation.service';
import { ReportTargets } from './reports/report-targets';
import { Report, ReportSchema } from './reports/report.schema';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { Comment, CommentSchema } from './schemas/comment.schema';
import { Post, PostSchema } from './schemas/post.schema';

/**
 * Owner: Ahmed Ismail
 * Requirements: BLG-01..13, GEN-09
 *
 * GEN-09 report submission (`POST /api/reports`) and the Report schema, read
 * and resolved by the admin module through `ReportDirectory` (GEN-10).
 * Posts and comments have `isHidden` with hide/unhide/delete in
 * `BlogModerationService`, registered with the admin `ContentModerators`.
 * Other content modules can register a `ReportTarget` (exported) so reports
 * of their items are checked for existence and visibility.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Report.name, schema: ReportSchema },
    ]),
    AdminModule,
  ],
  controllers: [ReportsController],
  providers: [ReportTargets, ReportsService, BlogModerationService],
  exports: [ReportTargets, BlogModerationService],
})
export class BlogModule {}

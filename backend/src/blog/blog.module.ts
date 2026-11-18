import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { AuthorItineraries } from './author-itineraries';
import { BlogModerationService } from './blog-moderation.service';
import {
  AuthorsController,
  PublicPostsController,
} from './public-posts.controller';
import { PublicPostsService } from './public-posts.service';
import { CommentsService } from './comments.service';
import {
  CommentsController,
  PostCommunityController,
} from './community.controller';
import { LikesService } from './likes.service';
import { Like, LikeSchema } from './schemas/like.schema';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { TagsController } from './tags.controller';
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
 * BLG-01, 03, 04, 08, 10: authors create, list, edit and delete their posts
 * (`/api/posts`), with tags (`GET /api/tags/:tag/posts`) and images through
 * the upload helper (GEN-08).
 *
 * BLG-02, 09, 12: public browsing (`GET /api/posts`, `GET /api/posts/:id`),
 * search ordered by likes + comments (`GET /api/posts/search`) and the
 * author page (`GET /api/authors/:id`). Public itineraries on the author
 * page come from the itinerary module through `AuthorItineraries` (exported).
 *
 * BLG-05, 06, 07: comments on published posts (`/api/posts/:id/comments`,
 * `/api/comments/:id`) and one like per user per post (`/api/posts/:id/like`).
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
      { name: Like.name, schema: LikeSchema },
    ]),
    AdminModule,
    UploadsModule,
    UsersModule,
  ],
  // PostsController first: its GET /posts/mine must win over GET /posts/:id.
  controllers: [
    PostsController,
    PublicPostsController,
    PostCommunityController,
    CommentsController,
    TagsController,
    AuthorsController,
    ReportsController,
  ],
  providers: [
    ReportTargets,
    ReportsService,
    BlogModerationService,
    PostsService,
    PublicPostsService,
    CommentsService,
    LikesService,
    AuthorItineraries,
  ],
  exports: [
    ReportTargets,
    BlogModerationService,
    PostsService,
    LikesService,
    AuthorItineraries,
  ],
})
export class BlogModule {}

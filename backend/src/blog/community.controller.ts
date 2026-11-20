import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role, type AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { Paginated } from '../common/pagination/pagination';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { CommentsService } from './comments.service';
import type { CommentView } from './comments.service';
import { CommentBodyDto, ListCommentsQueryDto } from './dto/comment.dto';
import { LikesService } from './likes.service';
import type { LikeState } from './likes.service';

const COMMENT_EXAMPLE = {
  id: '6650f1c2a1b2c3d4e5f60a01',
  postId: '6650f1c2a1b2c3d4e5f60789',
  author: { id: '6650f1c2a1b2c3d4e5f60111', name: 'Amina' },
  body: 'Great tips, thanks!',
  isHidden: false,
  editedAt: null,
  createdAt: '2026-11-18T10:05:00.000Z',
};

const LIKE_EXAMPLE = {
  postId: '6650f1c2a1b2c3d4e5f60789',
  liked: true,
  likeCount: 4,
};

/** Likes and comments on published posts (BLG-05, BLG-06). */
@ApiTags('blog')
@Controller('posts/:id')
@ApiParam({ name: 'id', description: 'Post id' })
export class PostCommunityController {
  constructor(
    private readonly comments: CommentsService,
    private readonly likes: LikesService,
  ) {}

  @Get('comments')
  @Public()
  @ApiReq(
    'BLG-05',
    'List comments of a post',
    'Comments of a published post in chronological order (oldest first), 10 per page. Public. Hidden comments are shown only to their author and admins.',
  )
  @ApiOkResponse({
    schema: {
      example: { items: [COMMENT_EXAMPLE], total: 1, page: 1, limit: 10 },
    },
  })
  @ApiNotFoundResponse({ description: 'No such published post' })
  listComments(
    @Param('id') id: string,
    @Query() query: ListCommentsQueryDto,
    @CurrentUser() viewer?: AuthUser,
  ): Promise<Paginated<CommentView>> {
    return this.comments.list(id, query, viewer);
  }

  @Post('comments')
  @Roles(Role.USER)
  @ApiCookieAuth()
  @ApiReq(
    'BLG-05',
    'Comment on a post',
    'Registered users comment on a published post. The comment must not be empty and can be at most 500 characters.',
  )
  @ApiCreatedResponse({ schema: { example: COMMENT_EXAMPLE } })
  @ApiBadRequestResponse({ description: 'Empty or longer than 500 characters' })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiNotFoundResponse({ description: 'No such published post' })
  addComment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentView> {
    return this.comments.create(user, id, dto.body);
  }

  @Post('like')
  @Roles(Role.USER)
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiReq(
    'BLG-06',
    'Like a post',
    'Registered users like a published post once. Returns the new like count.',
  )
  @ApiOkResponse({ schema: { example: LIKE_EXAMPLE } })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiNotFoundResponse({ description: 'No such published post' })
  @ApiConflictResponse({
    description: 'You already like this post (ALREADY_LIKED)',
  })
  like(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<LikeState> {
    return this.likes.like(user, id);
  }

  @Delete('like')
  @Roles(Role.USER)
  @ApiCookieAuth()
  @ApiReq(
    'BLG-06',
    'Remove my like',
    'Removes your like and returns the new like count.',
  )
  @ApiOkResponse({
    schema: { example: { ...LIKE_EXAMPLE, liked: false, likeCount: 3 } },
  })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiNotFoundResponse({
    description: 'No such published post, or you have not liked it',
  })
  unlike(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<LikeState> {
    return this.likes.unlike(user, id);
  }
}

/** Editing and deleting your own comments (BLG-07). */
@ApiTags('blog')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not signed in' })
@ApiForbiddenResponse({
  description: 'Someone else’s comment, or not a registered user',
})
@Roles(Role.USER)
@Controller('comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Patch(':id')
  @ApiReq(
    'BLG-07',
    'Edit my comment',
    'Change the text of your own comment (1-500 characters).',
  )
  @ApiParam({ name: 'id', description: 'Comment id' })
  @ApiOkResponse({
    schema: {
      example: { ...COMMENT_EXAMPLE, editedAt: '2026-11-18T10:20:00.000Z' },
    },
  })
  @ApiBadRequestResponse({ description: 'Empty or longer than 500 characters' })
  @ApiForbiddenResponse({ description: 'Someone else’s comment' })
  @ApiNotFoundResponse({ description: 'No such comment' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentView> {
    return this.comments.update(user, id, dto.body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiReq(
    'BLG-07',
    'Delete my comment',
    'Deletes your own comment; the post’s comment count goes down.',
  )
  @ApiParam({ name: 'id', description: 'Comment id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({ description: 'Someone else’s comment' })
  @ApiNotFoundResponse({ description: 'No such comment' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.comments.remove(user, id);
  }
}

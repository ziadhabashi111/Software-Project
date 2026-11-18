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
  UploadedFiles,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { Paginated } from '../common/pagination/pagination';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { ImageUpload } from '../uploads/image-upload.decorator';
import {
  CreatePostDto,
  IMAGES_MAX,
  ListMyPostsQueryDto,
  UpdatePostDto,
} from './dto/post.dto';
import type { MyPostRow, PostView } from './post-view';
import { PostsService } from './posts.service';

const POST_EXAMPLE = {
  id: '6650f1c2a1b2c3d4e5f60789',
  title: 'Three days in Cairo',
  body: 'Day 1: the pyramids at sunrise...',
  tags: ['cairo', 'food'],
  images: [
    {
      id: '6650f1c2a1b2c3d4e5f60790',
      url: 'http://localhost:3000/uploads/3f1c2b9e-8a7d-4c1e-9b2a-1d4e5f6a7b8c.jpg',
    },
  ],
  status: 'published',
  isHidden: false,
  date: '2026-11-18T10:00:00.000Z',
  publishedAt: '2026-11-18T10:00:00.000Z',
  createdAt: '2026-11-18T09:00:00.000Z',
  updatedAt: '2026-11-18T10:00:00.000Z',
  likeCount: 0,
  commentCount: 0,
};

/** The author's own posts. Every route needs sign-in; changes are author-only. */
@ApiTags('blog')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not signed in' })
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  @ApiReq(
    ['BLG-01', 'BLG-08'],
    'Create a post',
    'Required title (up to 150 characters) and body. Optional: up to 5 tags of at most 30 characters (stored lower-case, duplicates removed), up to 5 image URLs from POST /api/uploads/images, and status draft (default, only you see it) or published.',
  )
  @ApiCreatedResponse({ schema: { example: POST_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Field errors (title, body, tags, imageUrls, status)',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePostDto,
  ): Promise<PostView> {
    return this.posts.create(user, dto);
  }

  @Get('mine')
  @ApiReq(
    'BLG-03',
    'List my posts',
    'Your posts including drafts, newest first: title, status, date, like and comment counts. Optional status filter. 10 per page.',
  )
  @ApiOkResponse({
    schema: {
      example: {
        items: [
          {
            id: POST_EXAMPLE.id,
            title: POST_EXAMPLE.title,
            status: 'draft',
            isHidden: false,
            date: POST_EXAMPLE.createdAt,
            tags: POST_EXAMPLE.tags,
            likeCount: 0,
            commentCount: 0,
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      },
    },
  })
  listMine(
    @CurrentUser() user: AuthUser,
    @Query() query: ListMyPostsQueryDto,
  ): Promise<Paginated<MyPostRow>> {
    return this.posts.listMine(user, query);
  }

  @Get('mine/:id')
  @ApiReq(
    'BLG-04',
    'Get my post for editing',
    'One of your own posts with its body and images, including drafts.',
  )
  @ApiParam({ name: 'id', description: 'Post id' })
  @ApiOkResponse({ schema: { example: POST_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'No such post of yours' })
  getMine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<PostView> {
    return this.posts.getOwn(user, id);
  }

  @Patch(':id')
  @ApiReq(
    ['BLG-04', 'BLG-08'],
    'Edit my post',
    'Change the title, body, tags or status. Publishing for the first time sets the publish date. Only the author can edit.',
  )
  @ApiParam({ name: 'id', description: 'Post id' })
  @ApiOkResponse({ schema: { example: POST_EXAMPLE } })
  @ApiBadRequestResponse({ description: 'Field errors' })
  @ApiForbiddenResponse({ description: 'Someone else’s published post' })
  @ApiNotFoundResponse({
    description: 'No such post (or a draft or hidden post of someone else)',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ): Promise<PostView> {
    return this.posts.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiReq(
    'BLG-04',
    'Delete my post',
    'Deletes the post with its comments and images. Only the author can delete.',
  )
  @ApiParam({ name: 'id', description: 'Post id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({ description: 'Someone else’s published post' })
  @ApiNotFoundResponse({ description: 'No such post' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.posts.remove(user, id);
  }

  @Post(':id/images')
  @ImageUpload('images', IMAGES_MAX)
  @ApiReq(
    ['BLG-10', 'GEN-08'],
    'Add images to my post',
    'Multipart field "images": JPG or PNG, up to 5 MB each, at most 5 images per post in total. Nothing is stored if any file breaks the rules.',
  )
  @ApiParam({ name: 'id', description: 'Post id' })
  @ApiCreatedResponse({ schema: { example: POST_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Not JPG/PNG, over 5 MB, or more than 5 images',
  })
  @ApiForbiddenResponse({ description: 'Someone else’s published post' })
  @ApiNotFoundResponse({ description: 'No such post' })
  addImages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ): Promise<PostView> {
    return this.posts.addImages(user, id, files);
  }

  @Delete(':id/images/:imageId')
  @ApiReq(
    'BLG-10',
    'Remove an image from my post',
    'Removes the image from the post and deletes the file.',
  )
  @ApiParam({ name: 'id', description: 'Post id' })
  @ApiParam({ name: 'imageId', description: 'Image id from the post' })
  @ApiOkResponse({ schema: { example: { ...POST_EXAMPLE, images: [] } } })
  @ApiForbiddenResponse({ description: 'Someone else’s published post' })
  @ApiNotFoundResponse({ description: 'No such post or image' })
  removeImage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ): Promise<PostView> {
    return this.posts.removeImage(user, id, imageId);
  }
}

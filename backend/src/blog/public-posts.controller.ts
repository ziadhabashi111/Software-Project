import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { Paginated } from '../common/pagination/pagination';
import { ApiReq } from '../common/swagger/api-req.decorator';
import {
  AuthorPageQueryDto,
  BrowsePostsQueryDto,
  SearchPostsQueryDto,
} from './dto/browse.dto';
import type { PublicPostRow } from './post-view';
import { PublicPostsService } from './public-posts.service';
import type { AuthorPageView, PublicPostView } from './public-posts.service';

const ROW_EXAMPLE = {
  id: '6650f1c2a1b2c3d4e5f60789',
  title: 'Three days in Cairo',
  author: { id: '6650f1c2a1b2c3d4e5f60111', name: 'Ahmed' },
  date: '2026-11-18T10:00:00.000Z',
  excerpt: 'Day 1: the pyramids at sunrise...',
  tags: ['cairo', 'food'],
  likeCount: 5,
  commentCount: 2,
};

const pageOf = (items: unknown[]) => ({
  items,
  total: items.length,
  page: 1,
  limit: 10,
});

/** What guests can read. Signed-in users additionally see their own drafts and likes. */
@ApiTags('blog')
@Controller('posts')
export class PublicPostsController {
  constructor(private readonly publicPosts: PublicPostsService) {}

  @Get()
  @Public()
  @ApiReq(
    ['BLG-02', 'BLG-08'],
    'Browse published posts',
    'Published posts, newest first, 10 per page: title, author, date, excerpt, tags, like and comment counts. Optional tag filter. Posts of deactivated authors are not shown (ACC-12).',
  )
  @ApiOkResponse({ schema: { example: pageOf([ROW_EXAMPLE]) } })
  browse(
    @Query() query: BrowsePostsQueryDto,
  ): Promise<Paginated<PublicPostRow>> {
    return this.publicPosts.browse(query, query.tag);
  }

  @Get('search')
  @Public()
  @ApiReq(
    'BLG-09',
    'Search posts',
    'Published posts whose title, tags or author name contain the keyword (case-insensitive), ordered by interaction score (likes + comments) descending, newest first on ties. Shows title, author, date and excerpt. An empty `items` list means no results.',
  )
  @ApiOkResponse({ schema: { example: pageOf([ROW_EXAMPLE]) } })
  @ApiBadRequestResponse({ description: 'Missing keyword' })
  search(
    @Query() query: SearchPostsQueryDto,
  ): Promise<Paginated<PublicPostRow>> {
    return this.publicPosts.search(query.q, query);
  }

  @Get(':id')
  @Public()
  @ApiReq(
    'BLG-02',
    'Open a post',
    'Title, author, date, body, tags, images, like count and the first page of comments (oldest first). Drafts are visible only to their author, and hidden posts only to the author and admins; otherwise 404. `likedByMe` is null for guests.',
  )
  @ApiParam({ name: 'id', description: 'Post id' })
  @ApiOkResponse({
    schema: {
      example: {
        ...ROW_EXAMPLE,
        body: 'Day 1: the pyramids at sunrise...',
        images: [],
        status: 'published',
        isHidden: false,
        likedByMe: false,
        comments: pageOf([]),
      },
    },
  })
  @ApiNotFoundResponse({ description: 'No such post, or not visible to you' })
  get(
    @Param('id') id: string,
    @CurrentUser() viewer?: AuthUser,
  ): Promise<PublicPostView> {
    return this.publicPosts.getPost(id, viewer);
  }
}

@ApiTags('blog')
@Controller('authors')
export class AuthorsController {
  constructor(private readonly publicPosts: PublicPostsService) {}

  @Get(':id')
  @Public()
  @ApiReq(
    'BLG-12',
    'Author page',
    "The author's name, join date, published posts (newest first, paginated with page/limit) and public itineraries (10 per page, itinerariesPage). Deactivated authors have no page (ACC-12).",
  )
  @ApiParam({ name: 'id', description: 'User id of the author' })
  @ApiOkResponse({
    schema: {
      example: {
        id: '6650f1c2a1b2c3d4e5f60111',
        name: 'Ahmed',
        joinedAt: '2026-11-12T08:00:00.000Z',
        posts: pageOf([ROW_EXAMPLE]),
        itineraries: {
          items: [
            {
              id: '6650f1c2a1b2c3d4e5f60222',
              title: 'Egypt in a week',
              countries: ['EG'],
              startDate: '2026-12-01',
              dayCount: 7,
            },
          ],
          total: 1,
          page: 1,
          limit: 10,
        },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'No such author, or the account is deactivated',
  })
  get(
    @Param('id') id: string,
    @Query() query: AuthorPageQueryDto,
  ): Promise<AuthorPageView> {
    return this.publicPosts.authorPage(id, query);
  }
}

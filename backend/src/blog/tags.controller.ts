import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import type { Paginated } from '../common/pagination/pagination';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { ListTagPostsQueryDto } from './dto/post.dto';
import type { PublicPostRow } from './post-view';
import { PublicPostsService } from './public-posts.service';

@ApiTags('blog')
@Controller('tags')
export class TagsController {
  constructor(private readonly publicPosts: PublicPostsService) {}

  @Get(':tag/posts')
  @Public()
  @ApiReq(
    'BLG-08',
    'Posts with a tag',
    'Published posts with this tag (case-insensitive), newest first: title, author, date, excerpt, tags, like and comment counts. Public. 10 per page. Posts of deactivated authors are not shown (ACC-12).',
  )
  @ApiParam({ name: 'tag', example: 'cairo' })
  @ApiOkResponse({
    schema: {
      example: {
        items: [
          {
            id: '6650f1c2a1b2c3d4e5f60789',
            title: 'Three days in Cairo',
            author: { id: '6650f1c2a1b2c3d4e5f60111', name: 'Ahmed' },
            date: '2026-11-18T10:00:00.000Z',
            excerpt: 'Day 1: the pyramids at sunrise...',
            tags: ['cairo', 'food'],
            likeCount: 3,
            commentCount: 1,
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      },
    },
  })
  list(
    @Param('tag') tag: string,
    @Query() query: ListTagPostsQueryDto,
  ): Promise<Paginated<PublicPostRow>> {
    return this.publicPosts.browse(query, tag.trim().toLowerCase());
  }
}

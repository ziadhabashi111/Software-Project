import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import type { Paginated } from '../common/pagination/pagination';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { BudgetSummaryQueryDto } from './budget/dto/budget-summary-query.dto';
import { PublicSearchQueryDto } from './dto/public-search-query.dto';
import { PublicItinerariesService } from './public-itineraries.service';
import type {
  PublicItineraryListItem,
  PublicItineraryView,
} from './public-itinerary-view';

/**
 * Public itineraries (ITN-21): open to everyone, including visitors who are
 * not signed in. Registered before `ItinerariesController` so `public/...`
 * is never read as an itinerary id.
 */
@ApiTags('itineraries')
@Controller('itineraries/public')
export class PublicItinerariesController {
  constructor(private readonly publicItineraries: PublicItinerariesService) {}

  @Get('search')
  @Public()
  @ApiReq(
    'ITN-21',
    'Search public itineraries',
    'Open to everyone. Only public itineraries are listed: private ones, ones a moderator hid and ones of deactivated accounts never appear. The keyword is found in the title or in the name or code of a country or city of the itinerary; filter by country, city and the number of days (inclusive). Newest first, 10 per page.',
  )
  @ApiOkResponse({
    schema: {
      example: {
        items: [
          {
            id: '6660a1b2c3d4e5f601234567',
            title: 'A week in Egypt',
            countries: ['EG'],
            startDate: '2027-03-01',
            dayCount: 7,
            author: { id: '665f1c2a9b1e8a0012345670', name: 'Nora' },
            updatedAt: '2026-11-18T10:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Fewest days above most days, or a malformed filter',
  })
  search(
    @Query() query: PublicSearchQueryDto,
  ): Promise<Paginated<PublicItineraryListItem>> {
    return this.publicItineraries.search(query);
  }

  @Get(':id')
  @Public()
  @ApiReq(
    'ITN-21',
    'Read a public itinerary',
    'Read-only: the author, the numbered and dated days with their activities, the city groups and the budget (by category and by day, converted to `currency`, the platform currency when omitted). Private, hidden and deactivated-author itineraries answer 404. If exchange rates are unavailable the itinerary still opens, with `budget: null`.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ description: 'The public itinerary' })
  @ApiBadRequestResponse({ description: 'Unsupported currency' })
  @ApiNotFoundResponse({ description: 'Not found, or not public' })
  get(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: BudgetSummaryQueryDto,
  ): Promise<PublicItineraryView> {
    return this.publicItineraries.get(id, query.currency);
  }
}

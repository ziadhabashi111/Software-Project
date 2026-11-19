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
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Paginated, PaginationQueryDto } from '../common/pagination/pagination';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { ConfirmQueryDto } from './dto/confirm.dto';
import { CreateDayDto } from './dto/create-day.dto';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { ReorderDaysDto } from './dto/reorder-days.dto';
import { UpdateDayDto } from './dto/update-day.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { ItinerariesService } from './itineraries.service';
import { ItineraryCloneService } from './itinerary-clone.service';
import type { ItinerarySummary, ItineraryView } from './itinerary-view';

/** Itineraries belong to regular users; everyone else gets 403 (ITN-11). */
@ApiTags('itineraries')
@ApiCookieAuth()
@Roles(Role.USER)
@ApiForbiddenResponse({ description: 'Only regular users plan itineraries' })
@Controller('itineraries')
export class ItinerariesController {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly cloning: ItineraryCloneService,
  ) {}

  @Post()
  @ApiReq(
    'ITN-01',
    'Create an itinerary',
    'A title (up to 100 characters), one or more countries from the predefined list and a start date. It is private by default.',
  )
  @ApiCreatedResponse({ description: 'The new, empty itinerary' })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateItineraryDto,
  ): Promise<ItineraryView> {
    return this.itineraries.create(user, dto);
  }

  @Get()
  @ApiReq(
    'ITN-03',
    'List my itineraries',
    'Title, countries, start date, number of days and visibility, most recently updated first, 10 per page.',
  )
  @ApiOkResponse({ description: 'A page of my itineraries' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<ItinerarySummary>> {
    return this.itineraries.list(user, query);
  }

  @Post(':id/clone')
  @ApiReq(
    'ITN-21',
    'Clone an itinerary',
    'Copies the days, activities and budget entries of a public itinerary (or one of your own) into a new private itinerary of yours. The copy credits the original author (`clonedFrom`) and is independent of the original: later changes to either do not affect the other. Activity images are not copied. A private or hidden itinerary of someone else answers 404.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id to copy' })
  @ApiCreatedResponse({ description: 'Your new private copy' })
  @ApiNotFoundResponse({ description: 'Not found, or not public' })
  clone(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ItineraryView> {
    return this.cloning.clone(user, id);
  }

  @Get(':id')
  @ApiReq(
    ['ITN-03', 'ITN-09'],
    'Open one of my itineraries',
    'Days are numbered and dated from the start date. Consecutive days in the same city are also returned as groups with the day count and the budget subtotal (null until the budget module is connected). Owner only: anyone else gets 404.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({
    description: 'The itinerary with its days, activities and groups',
  })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ItineraryView> {
    return this.itineraries.get(user, id);
  }

  @Patch(':id')
  @ApiReq(
    ['ITN-01', 'ITN-20'],
    'Edit an itinerary',
    'Change the title, countries, start date (all day dates follow it) or visibility. Setting private removes it from public search immediately. Nothing is saved unless every field is valid.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ description: 'The updated itinerary' })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateItineraryDto,
  ): Promise<ItineraryView> {
    return this.itineraries.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiReq(
    'ITN-01',
    'Delete an itinerary',
    'Requires ?confirm=true. It disappears from public search; copies other users made earlier are not affected.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  async remove(
    // Validated only: the delete runs once the confirmation is there.
    @Query() _confirm: ConfirmQueryDto,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    await this.itineraries.remove(user, id);
  }

  @Post(':id/days')
  @ApiReq(
    ['ITN-05', 'ITN-09'],
    'Add a day',
    'Added at the end. The city is required and must come from the predefined city list. Numbers and dates follow the order and the start date. At most 60 days.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiCreatedResponse({ description: 'The updated itinerary' })
  @ApiConflictResponse({ description: 'Already 60 days (MAX_DAYS_REACHED)' })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  addDay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateDayDto,
  ): Promise<ItineraryView> {
    return this.itineraries.addDay(user, id, dto);
  }

  // Declared before ':dayId' so "reorder" is not read as a day id.
  @Patch(':id/days/reorder')
  @ApiReq(
    'ITN-08',
    'Move a day',
    'Moves one day to a new position (1 to the number of days). Days are renumbered, dates and city groups recalculated.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ description: 'The updated itinerary' })
  @ApiNotFoundResponse({ description: 'Itinerary or day not found' })
  moveDay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ReorderDaysDto,
  ): Promise<ItineraryView> {
    return this.itineraries.moveDay(user, id, dto.dayId, dto.position);
  }

  @Patch(':id/days/:dayId')
  @ApiReq(
    'ITN-05',
    "Edit a day's city or notes",
    'Send notes: null to clear them.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiParam({ name: 'dayId', description: 'Day id' })
  @ApiOkResponse({ description: 'The updated itinerary' })
  @ApiNotFoundResponse({ description: 'Itinerary or day not found' })
  updateDay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: UpdateDayDto,
  ): Promise<ItineraryView> {
    return this.itineraries.updateDay(user, id, dayId, dto);
  }

  @Delete(':id/days/:dayId')
  @ApiReq(
    'ITN-07',
    'Delete a day',
    'Requires ?confirm=true. The remaining days are renumbered and their dates and budget totals recalculated; the day activities go with it.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiParam({ name: 'dayId', description: 'Day id' })
  @ApiOkResponse({ description: 'The updated itinerary' })
  @ApiNotFoundResponse({ description: 'Itinerary or day not found' })
  removeDay(
    @Query() _confirm: ConfirmQueryDto,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
  ): Promise<ItineraryView> {
    return this.itineraries.removeDay(user, id, dayId);
  }
}

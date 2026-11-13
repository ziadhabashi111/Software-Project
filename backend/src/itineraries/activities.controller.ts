import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
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
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { ActivitiesService } from './activities.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import type { ActivityView } from './itinerary-view';

/** Activities of an itinerary day (ITN-10). Owner only: anyone else gets 404. */
@ApiTags('itineraries')
@ApiCookieAuth()
@Roles(Role.USER)
@ApiForbiddenResponse({ description: 'Only regular users plan itineraries' })
@Controller()
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Post('itineraries/:id/days/:dayId/activities')
  @ApiReq(
    'ITN-10',
    'Add an activity to a day',
    'A name is required; description, time (HH:mm), cost and the currency of the cost are optional.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiParam({ name: 'dayId', description: 'Day id' })
  @ApiCreatedResponse({ description: 'The new activity' })
  @ApiNotFoundResponse({ description: 'Itinerary or day not found' })
  add(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: CreateActivityDto,
  ): Promise<ActivityView> {
    return this.activities.add(user, id, dayId, dto);
  }

  @Patch('activities/:id')
  @ApiReq(
    'ITN-10',
    'Edit an activity',
    'Send null to clear the description, time, cost or currency. Nothing is saved unless every field is valid.',
  )
  @ApiParam({ name: 'id', description: 'Activity id' })
  @ApiOkResponse({ description: 'The updated activity' })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateActivityDto,
  ): Promise<ActivityView> {
    return this.activities.update(user, id, dto);
  }

  @Delete('activities/:id')
  @HttpCode(204)
  @ApiReq('ITN-10', 'Delete an activity')
  @ApiParam({ name: 'id', description: 'Activity id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.activities.remove(user, id);
  }
}

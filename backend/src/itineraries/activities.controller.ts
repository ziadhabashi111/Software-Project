import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
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
} from '@nestjs/swagger';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { IMAGE_LIMITS } from '../uploads/image-rules';
import { ImageUpload } from '../uploads/image-upload.decorator';
import { ActivitiesService } from './activities.service';
import { ActivityImagesService } from './activity-images.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import type { ActivityView } from './itinerary-view';

/** Activities of an itinerary day and their images (ITN-10, ITN-12). Owner only: anyone else gets 404. */
@ApiTags('itineraries')
@ApiCookieAuth()
@Roles(Role.USER)
@ApiForbiddenResponse({ description: 'Only regular users plan itineraries' })
@Controller()
export class ActivitiesController {
  constructor(
    private readonly activities: ActivitiesService,
    private readonly images: ActivityImagesService,
  ) {}

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

  @Post('activities/:id/images')
  @ImageUpload('images', IMAGE_LIMITS.activity)
  @ApiReq(
    ['ITN-12', 'GEN-08'],
    'Add images to an activity',
    'Multipart field "images": JPG or PNG (the real file format is checked), up to 5 MB each, at most 5 images per activity in total. Nothing is stored if any file breaks the rules. Returns the activity with all its images.',
  )
  @ApiParam({ name: 'id', description: 'Activity id' })
  @ApiCreatedResponse({ description: 'The activity with its images' })
  @ApiBadRequestResponse({
    description: 'Not JPG/PNG, over 5 MB, no file, or more than 5 images',
  })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  addImages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ): Promise<ActivityView> {
    return this.images.add(user, id, files);
  }

  @Delete('activities/:id/images/:imageId')
  @ApiReq(
    ['ITN-12', 'GEN-08'],
    'Remove an image from an activity',
    'Removes the image from the activity and deletes its file. Returns the activity with its remaining images.',
  )
  @ApiParam({ name: 'id', description: 'Activity id' })
  @ApiParam({ name: 'imageId', description: 'Image id' })
  @ApiOkResponse({ description: 'The activity with its remaining images' })
  @ApiNotFoundResponse({
    description: 'Activity or image not found, or not yours',
  })
  removeImage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('imageId', ParseObjectIdPipe) imageId: string,
  ): Promise<ActivityView> {
    return this.images.remove(user, id, imageId);
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

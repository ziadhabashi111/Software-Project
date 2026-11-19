import { Controller, Delete, Param, Post, UploadedFiles } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
import type { HotelView } from './hotel-view';
import { HotelPhotosService } from './hotel-photos.service';

/** Photos of a hotel (HTL-01, GEN-08). Only the hotel's own moderator. */
@ApiTags('hotels')
@ApiCookieAuth()
@Roles(Role.HOTEL_MODERATOR)
@ApiForbiddenResponse({ description: 'Not the moderator of this hotel' })
@ApiNotFoundResponse({ description: 'Hotel (or photo) not found' })
@Controller('hotels/:id/images')
export class HotelPhotosController {
  constructor(private readonly photos: HotelPhotosService) {}

  @Post()
  @ImageUpload('images', IMAGE_LIMITS.hotel)
  @ApiReq(
    ['HTL-01', 'GEN-08'],
    'Add photos to my hotel (moderator)',
    'Multipart field "images": JPG or PNG (the real file format is checked), up to 5 MB each, at most 5 photos per hotel in total. Nothing is stored if any file breaks the rules. Returns the hotel with all its photos.',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiCreatedResponse({ description: 'The hotel with its photos' })
  @ApiBadRequestResponse({
    description: 'Not JPG/PNG, over 5 MB, no file, or more than 5 photos',
  })
  add(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ): Promise<HotelView> {
    return this.photos.add(user, id, files);
  }

  @Delete(':imageId')
  @ApiReq(
    ['HTL-01', 'GEN-08'],
    'Remove a photo from my hotel (moderator)',
    'Removes the photo and deletes its file. Returns the hotel with its remaining photos.',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'imageId', description: 'Photo id' })
  @ApiOkResponse({ description: 'The hotel with its remaining photos' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('imageId', ParseObjectIdPipe) imageId: string,
  ): Promise<HotelView> {
    return this.photos.remove(user, id, imageId);
  }
}

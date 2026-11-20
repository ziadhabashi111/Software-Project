import {
  Controller,
  ForbiddenException,
  Post,
  Query,
  UploadedFiles,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiPropertyOptional,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { ImageUpload } from './image-upload.decorator';
import {
  IMAGE_LIMITS,
  UPLOADER_ROLE,
  type ImageOwnerKind,
} from './image-rules';
import { UploadsService, type StoredImage } from './uploads.service';

const KINDS = Object.keys(IMAGE_LIMITS) as ImageOwnerKind[];

export class UploadImagesQueryDto {
  @ApiPropertyOptional({
    enum: KINDS,
    default: 'post',
    description:
      'What the images are for; sets the count limit (airlineLogo: 1, others: 5)',
  })
  @IsOptional()
  @IsIn(KINDS)
  kind: ImageOwnerKind = 'post';
}

/**
 * GEN-08: stand-alone upload for flows that save a URL afterwards (for
 * example the airline logo, FLT-01). Modules that attach images to their own
 * records (posts, activities, hotels) can call `UploadsService` directly.
 */
@ApiTags('uploads')
@ApiCookieAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('images')
  @ImageUpload()
  @ApiReq(
    'GEN-08',
    'Upload images',
    'Signed-in users upload JPG or PNG images for what they own: kind=post or activity (registered users), hotel (hotel moderators), airlineLogo (airline moderators). Up to 5 MB each; up to 5, or 1 for kind=airlineLogo. The real file format is checked, not just the name. Returns the URLs to save on the post, activity, hotel or airline. Each file is recorded as uploaded by the caller; only the caller can later reuse its URL or delete it. Anything outside the limits is rejected and nothing is stored.',
  )
  @ApiCreatedResponse({
    schema: {
      example: {
        images: [
          {
            id: '3f1c2b9e-8a7d-4c1e-9b2a-1d4e5f6a7b8c.png',
            url: 'http://localhost:3000/uploads/3f1c2b9e-8a7d-4c1e-9b2a-1d4e5f6a7b8c.png',
          },
        ],
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'No file, not a JPG/PNG, larger than 5 MB, or more files than allowed',
  })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiForbiddenResponse({
    description: 'Your role cannot upload images of this kind',
  })
  async upload(
    @Query() query: UploadImagesQueryDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<{ images: StoredImage[] }> {
    if (UPLOADER_ROLE[query.kind] !== user.role) {
      throw new ForbiddenException(
        'Your role cannot upload images of this kind',
      );
    }
    return {
      images: await this.uploads.saveImages(files, query.kind, user.id, 0, {
        standalone: true,
      }),
    };
  }
}

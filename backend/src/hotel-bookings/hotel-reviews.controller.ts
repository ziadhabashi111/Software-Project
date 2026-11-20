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
  ApiForbiddenResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import {
  CreateReviewDto,
  ReviewReplyDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { HotelReviewsPage, HotelReviewsService } from './hotel-reviews.service';
import type { HotelReviewView } from './review-view';

const REVIEW_EXAMPLE = {
  id: '6661b2c3d4e5f60123456789',
  reservationId: '6660a1b2c3d4e5f601234567',
  hotelId: '665f1c2a9b1e8a0012345670',
  rating: 5,
  text: 'Lovely view of the Nile and very helpful staff.',
  author: { id: '665e0a1b2c3d4e5f60123456', name: 'Mona Adel' },
  isHidden: false,
  reply: {
    text: 'Thank you for staying with us; we hope to see you again.',
    repliedAt: '2027-03-06T09:00:00.000Z',
  },
  createdAt: '2027-03-05T10:00:00.000Z',
  updatedAt: '2027-03-05T10:00:00.000Z',
};

@ApiTags('hotel-reviews')
@Controller()
export class HotelReviewsController {
  constructor(private readonly reviews: HotelReviewsService) {}

  @Post('hotel-bookings/:id/review')
  @ApiCookieAuth()
  @Roles(Role.USER)
  @ApiReq(
    'HTL-23',
    'Review a completed stay',
    'One rating (1-5) and an optional review (up to 1000 characters) per Completed reservation, whatever the number of rooms. Only for your own reservation once its check-out date has passed. The hotel average is recalculated.',
  )
  @ApiParam({ name: 'id', description: 'Reservation id' })
  @ApiCreatedResponse({ schema: { example: REVIEW_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'Reservation not found, or not yours' })
  @ApiConflictResponse({
    description:
      'Stay not completed yet (STAY_NOT_COMPLETED) or already reviewed (REVIEW_EXISTS)',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateReviewDto,
  ): Promise<HotelReviewView> {
    return this.reviews.create(user, id, dto);
  }

  @Patch('reviews/:id')
  @ApiCookieAuth()
  @Roles(Role.USER)
  @ApiReq(
    'HTL-23',
    'Edit my review',
    'Change the rating and/or the text (send text: null to remove it). The hotel average is recalculated.',
  )
  @ApiParam({ name: 'id', description: 'Review id' })
  @ApiOkResponse({ schema: { example: REVIEW_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Nothing to update, or invalid values',
  })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateReviewDto,
  ): Promise<HotelReviewView> {
    return this.reviews.update(user, id, dto);
  }

  @Delete('reviews/:id')
  @HttpCode(204)
  @ApiCookieAuth()
  @Roles(Role.USER)
  @ApiReq(
    'HTL-23',
    'Delete my review',
    'The hotel average is recalculated. You may review the stay again afterwards.',
  )
  @ApiParam({ name: 'id', description: 'Review id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.reviews.remove(user, id);
  }

  @Post('reviews/:id/reply')
  @HttpCode(200)
  @ApiCookieAuth()
  @Roles(Role.HOTEL_MODERATOR)
  @ApiReq(
    'HTL-26',
    'Reply to a review of my hotel',
    "The hotel's own moderator answers a review (1-1000 characters). One reply per review: calling again changes its text. Guests see it as the hotel's response, without the moderator's name; the reviewer gets an in-app notification for a new reply.",
  )
  @ApiParam({ name: 'id', description: 'Review id' })
  @ApiOkResponse({ schema: { example: REVIEW_EXAMPLE } })
  @ApiBadRequestResponse({ description: 'Empty or too long reply' })
  @ApiForbiddenResponse({ description: 'Not a review of your hotel' })
  @ApiNotFoundResponse({ description: 'Review not found or hidden' })
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ReviewReplyDto,
  ): Promise<HotelReviewView> {
    return this.reviews.reply(user, id, dto);
  }

  @Delete('reviews/:id/reply')
  @HttpCode(204)
  @ApiCookieAuth()
  @Roles(Role.HOTEL_MODERATOR)
  @ApiReq('HTL-26', "Remove my hotel's reply to a review")
  @ApiParam({ name: 'id', description: 'Review id' })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiBadRequestResponse({ description: 'Invalid request' })
  @ApiForbiddenResponse({ description: 'Not a review of your hotel' })
  @ApiNotFoundResponse({
    description: 'Review not found, hidden, or without a reply',
  })
  removeReply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.reviews.removeReply(user, id);
  }

  @Get('hotels/:id/reviews')
  @Public()
  @ApiReq(
    'HTL-24',
    "A hotel's rating and reviews",
    'Average rating (one decimal, null when unrated), number of ratings and the reviews newest first, 10 per page. Open to guests. Reviews by deactivated accounts show "Deleted user". Hidden reviews are shown only to their author and to admins, and do not count towards the average.',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiOkResponse({
    schema: {
      example: {
        averageRating: 4.5,
        ratingCount: 2,
        items: [REVIEW_EXAMPLE],
        total: 2,
        page: 1,
        limit: 10,
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Hotel not found' })
  list(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() viewer?: AuthUser,
  ): Promise<HotelReviewsPage> {
    return this.reviews.listForHotel(id, query, viewer);
  }
}

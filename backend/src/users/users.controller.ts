import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthCookiesService } from '../auth/auth-cookies.service';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { ConfirmDeactivationDto } from './dto/confirm-deactivation.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';
import type { UserProfile } from './user-profile';

@ApiTags('users')
@ApiCookieAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly profile: ProfileService,
    private readonly cookies: AuthCookiesService,
  ) {}

  @Get('me')
  @ApiReq(
    ['ACC-09', 'ACC-11'],
    'My profile',
    'Only ever returns the logged-in user.',
  )
  @ApiOkResponse({ description: 'The logged-in user' })
  me(@CurrentUser() user: AuthUser): Promise<UserProfile> {
    return this.profile.get(user.id);
  }

  @Patch('me')
  @ApiReq(
    'ACC-09',
    'Edit my profile',
    'Edit name, phone number and preferred currency. Every field is validated and nothing is saved unless all of them pass. Email, role and status cannot be changed here.',
  )
  @ApiOkResponse({ description: 'The updated profile' })
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfile> {
    return this.profile.update(user.id, dto);
  }

  @Delete('me')
  @Roles(Role.USER)
  @HttpCode(204)
  @ApiReq(
    'ACC-12',
    'Deactivate my account',
    'Requires ?confirm=true. Blocked (409, code UPCOMING_BOOKINGS) while the user has upcoming Confirmed bookings. Signs the user out everywhere; a deactivated user cannot log in, their posts and public itineraries are hidden and their comments and reviews show as "Deleted user". Only regular users can deactivate themselves.',
  )
  @ApiNoContentResponse({
    description: 'Account deactivated and cookies cleared',
  })
  @ApiConflictResponse({ description: 'Upcoming confirmed bookings' })
  @ApiForbiddenResponse({
    description: 'Admins and moderators cannot deactivate themselves',
  })
  async deactivate(
    @CurrentUser() user: AuthUser,
    @Query() _confirmation: ConfirmDeactivationDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.profile.deactivate(user.id);
    this.cookies.clear(res);
  }
}

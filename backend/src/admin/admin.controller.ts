import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Paginated } from '../common/pagination/pagination';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { UserProfile } from '../users/user-profile';
import { AdminAccountsService } from './admin-accounts.service';
import {
  AdminBookingRow,
  AdminBookingsService,
} from './admin-bookings.service';
import {
  AdminProvidersService,
  ProviderState,
} from './admin-providers.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ListAccountsQueryDto } from './dto/list-accounts.dto';
import { ListBookingsQueryDto } from './dto/list-bookings.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ProviderType } from './provider-directory';

/** Every route here is for administrators only. */
@ApiTags('admin')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly accounts: AdminAccountsService,
    private readonly providers: AdminProvidersService,
    private readonly bookings: AdminBookingsService,
  ) {}

  @Get('accounts')
  @ApiReq(
    'ACC-14',
    'List accounts',
    'Paginated (10 per page), newest registrations first. Search by name or email; filter by role and status.',
  )
  @ApiOkResponse({ description: 'A page of accounts' })
  listAccounts(
    @Query() query: ListAccountsQueryDto,
  ): Promise<Paginated<UserProfile>> {
    return this.accounts.list(query);
  }

  @Post('moderators')
  @ApiReq(
    'ACC-13',
    'Create a hotel or airline moderator',
    'Linked to exactly one existing airline or hotel, with a temporary password set by the admin. The moderator must change it at first login.',
  )
  @ApiConflictResponse({ description: 'Email already registered' })
  @ApiServiceUnavailableResponse({
    description: 'The airline or hotel module is not available yet',
  })
  createModerator(
    @CurrentUser() admin: AuthUser,
    @Body() dto: CreateModeratorDto,
  ): Promise<UserProfile> {
    return this.accounts.createModerator(admin.id, dto);
  }

  @Post('users/:id/reset-password')
  @HttpCode(204)
  @ApiReq(
    'ACC-07a',
    'Reset a user or moderator password',
    'Sets the temporary password the admin supplies. The account is signed out everywhere, any login lock is cleared and the next login must set a new password. Administrators cannot be reset.',
  )
  @ApiParam({ name: 'id', description: 'Account id' })
  @ApiNoContentResponse({ description: 'Password reset' })
  @ApiForbiddenResponse({ description: 'Administrator accounts' })
  @ApiNotFoundResponse({ description: 'No such account' })
  resetPassword(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ResetPasswordDto,
  ): Promise<void> {
    return this.accounts.resetPassword(admin.id, id, dto.temporaryPassword);
  }

  @Patch('accounts/:id/suspend')
  @ApiReq(
    ['ACC-15', 'ACC-16'],
    'Suspend a user or moderator',
    'A suspended account is signed out at once and cannot log in. Its bookings stay valid. 409 if it is not active. Administrators cannot be suspended.',
  )
  @ApiParam({ name: 'id', description: 'Account id' })
  @ApiOkResponse({ description: 'The suspended account' })
  @ApiConflictResponse({ description: 'Not an active account' })
  @ApiForbiddenResponse({ description: 'Administrator accounts' })
  suspend(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<UserProfile> {
    return this.accounts.suspend(admin.id, id);
  }

  @Patch('accounts/:id/reactivate')
  @ApiReq(
    ['ACC-15', 'ACC-16'],
    'Reactivate a suspended user or moderator',
    '409 if the account is not suspended (accounts deactivated by their owner stay deactivated).',
  )
  @ApiParam({ name: 'id', description: 'Account id' })
  @ApiOkResponse({ description: 'The reactivated account' })
  @ApiConflictResponse({ description: 'Not a suspended account' })
  reactivate(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<UserProfile> {
    return this.accounts.reactivate(admin.id, id);
  }

  @Patch('providers/:type/:id/deactivate')
  @ApiReq(
    'ACC-15',
    'Deactivate a hotel or airline',
    'Hidden from search and not bookable; existing Confirmed bookings stay valid. The provider moderators and travellers with Confirmed bookings get an in-app notification. Does nothing (changed: false) if it is already deactivated.',
  )
  @ApiParam({ name: 'type', enum: ProviderType })
  @ApiParam({ name: 'id', description: 'Hotel or airline id' })
  @ApiNotFoundResponse({ description: 'No such hotel or airline' })
  @ApiServiceUnavailableResponse({
    description: 'The airline or hotel module is not available yet',
  })
  deactivateProvider(
    @CurrentUser() admin: AuthUser,
    @Param('type', new ParseEnumPipe(ProviderType)) type: ProviderType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ProviderState> {
    return this.providers.setActive(admin.id, type, id, false);
  }

  @Patch('providers/:type/:id/reactivate')
  @ApiReq('ACC-15', 'Reactivate a hotel or airline')
  @ApiParam({ name: 'type', enum: ProviderType })
  @ApiParam({ name: 'id', description: 'Hotel or airline id' })
  @ApiNotFoundResponse({ description: 'No such hotel or airline' })
  @ApiServiceUnavailableResponse({
    description: 'The airline or hotel module is not available yet',
  })
  reactivateProvider(
    @CurrentUser() admin: AuthUser,
    @Param('type', new ParseEnumPipe(ProviderType)) type: ProviderType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ProviderState> {
    return this.providers.setActive(admin.id, type, id, true);
  }

  @Get('bookings')
  @ApiReq(
    'ACC-17',
    'List all flight and hotel bookings',
    'Read-only, newest first, 10 per page. Filter by type, status and a date range on the start date (departure or check-in). Empty until the booking modules are connected.',
  )
  @ApiOkResponse({ description: 'A page of bookings' })
  listBookings(
    @Query() query: ListBookingsQueryDto,
  ): Promise<Paginated<AdminBookingRow>> {
    return this.bookings.list(query);
  }
}

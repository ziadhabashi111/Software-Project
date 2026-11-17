import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import type { AirlineView } from './airline-view';
import { AirlinesService } from './airlines.service';
import { BaggagePolicyDto } from './dto/baggage-policy.dto';
import { CancellationPolicyDto } from './dto/cancellation-policy.dto';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';

const AIRLINE_EXAMPLE = {
  id: '665f1c2a9b1e8a0012345670',
  name: 'EgyptAir',
  code: 'MS',
  logoUrl: null,
  isActive: true,
  baggagePolicy: { extraBagPrice: 25, maxExtraBags: 2 },
  cancellationPolicy: [
    { daysBefore: 14, refundPercent: 100 },
    { daysBefore: 3, refundPercent: 50 },
  ],
};

@ApiTags('airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlines: AirlinesService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiCookieAuth()
  @ApiReq(
    'FLT-01',
    'Create an airline (admin)',
    'Creates the airline profile. Create its moderator afterwards with POST /api/admin/moderators (ACC-13), which links the moderator to this airline.',
  )
  @ApiCreatedResponse({ schema: { example: AIRLINE_EXAMPLE } })
  @ApiBadRequestResponse({ description: 'Invalid name or code' })
  @ApiConflictResponse({
    description: 'Another airline already uses this code',
  })
  @ApiForbiddenResponse({ description: 'Only admins create airlines' })
  create(@Body() dto: CreateAirlineDto): Promise<AirlineView> {
    return this.airlines.create(dto);
  }

  @Get(':id')
  @Public()
  @ApiReq(
    'FLT-01',
    'Get an airline',
    'Public for active airlines. A deactivated airline is hidden (404) except from admins and its own moderator.',
  )
  @ApiOkResponse({ schema: { example: AIRLINE_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'Airline not found or deactivated' })
  get(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user?: AuthUser,
  ): Promise<AirlineView> {
    return this.airlines.get(id, user);
  }

  @Patch(':id')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiReq(
    'FLT-01',
    'Edit own airline profile (moderator)',
    'Edits name, code or logo of the moderator’s own airline. The logo is the URL returned by the upload helper (one logo, JPG or PNG up to 5 MB).',
  )
  @ApiOkResponse({ schema: { example: AIRLINE_EXAMPLE } })
  @ApiBadRequestResponse({ description: 'Invalid name, code or logo URL' })
  @ApiConflictResponse({
    description: 'Another airline already uses this code',
  })
  @ApiForbiddenResponse({ description: 'Not the moderator of this airline' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAirlineDto,
  ): Promise<AirlineView> {
    return this.airlines.update(id, user, dto);
  }

  @Put(':id/baggage-policy')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiReq(
    'FLT-08',
    'Set the baggage policy (moderator)',
    'Price per extra bag (> 0) and the most extra bags one passenger can add (>= 0). Each extra bag has the same maximum weight as the cabin’s free baggage allowance (FLT-04).',
  )
  @ApiOkResponse({ schema: { example: AIRLINE_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Price not above 0 or negative bag count',
  })
  @ApiForbiddenResponse({ description: 'Not the moderator of this airline' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  setBaggagePolicy(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: BaggagePolicyDto,
  ): Promise<AirlineView> {
    return this.airlines.setBaggagePolicy(id, user, dto);
  }

  @Put(':id/cancellation-policy')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiReq(
    'FLT-09',
    'Set the cancellation policy (moderator)',
    'Replaces the tiers. Each tier has a unique days-before-departure threshold (whole number >= 0) and a refund percentage (0-100). A cancellation uses the tier with the highest threshold not exceeding the days remaining; if none applies the refund is 0%.',
  )
  @ApiOkResponse({ schema: { example: AIRLINE_EXAMPLE } })
  @ApiBadRequestResponse({
    description:
      'Duplicate threshold, negative days or a percentage outside 0-100',
  })
  @ApiForbiddenResponse({ description: 'Not the moderator of this airline' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  setCancellationPolicy(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CancellationPolicyDto,
  ): Promise<AirlineView> {
    return this.airlines.setCancellationPolicy(id, user, dto);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
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
import { Role } from '../../auth/auth.types';
import type { AuthUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../../common/swagger/api-req.decorator';
import { BudgetService } from './budget.service';
import type {
  BudgetEntryView,
  BudgetListView,
  TransportCostView,
} from './budget-view';
import { CreateBudgetEntryDto } from './dto/create-budget-entry.dto';
import { CreateTransportCostDto } from './dto/create-transport-cost.dto';
import { UpdateBudgetEntryDto } from './dto/update-budget-entry.dto';
import { UpdateTransportCostDto } from './dto/update-transport-cost.dto';

const ENTRY_EXAMPLE = {
  id: '6660a1b2c3d4e5f601234567',
  itineraryId: '665f1c2a9b1e8a0012345670',
  dayId: '665f1c2a9b1e8a0012345671',
  category: 'food',
  amount: 40,
  currency: 'EUR',
  note: 'Dinner',
};

const TRANSPORT_EXAMPLE = {
  id: '6660a1b2c3d4e5f601234568',
  itineraryId: '665f1c2a9b1e8a0012345670',
  dayId: '665f1c2a9b1e8a0012345671',
  mode: 'train',
  fromCity: 'cairo',
  toCity: 'luxor',
  amount: 35,
  currency: 'USD',
};

/** Budget entries and transport costs of an itinerary (ITN-14, ITN-16). Owner only: anyone else gets 404. */
@ApiTags('itinerary budget')
@ApiCookieAuth()
@Roles(Role.USER)
@ApiForbiddenResponse({ description: 'Only regular users plan itineraries' })
@Controller()
export class BudgetController {
  constructor(private readonly budget: BudgetService) {}

  @Get('itineraries/:id/budgets')
  @ApiReq(
    ['ITN-14', 'ITN-16'],
    'List budget entries and transport costs',
    'Every entry exactly as entered (original currency). Totals converted to your currency come from GET /api/itineraries/:id/budget-summary.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({
    schema: {
      example: {
        entries: [ENTRY_EXAMPLE],
        transportCosts: [TRANSPORT_EXAMPLE],
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Itinerary not found' })
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<BudgetListView> {
    return this.budget.list(user, id);
  }

  @Post('itineraries/:id/days/:dayId/budgets')
  @ApiReq(
    'ITN-14',
    'Add a budget entry to a day',
    'Category food, accommodation, in_city_transport or activities; a non-negative amount (up to 2 decimals) in the selected currency. Activity costs from ITN-10 are counted under activities automatically, so do not add them again.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiParam({ name: 'dayId', description: 'Day id' })
  @ApiCreatedResponse({ schema: { example: ENTRY_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Negative amount, unknown category or unsupported currency',
  })
  @ApiNotFoundResponse({ description: 'Itinerary or day not found' })
  createEntry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: CreateBudgetEntryDto,
  ): Promise<BudgetEntryView> {
    return this.budget.createEntry(user, id, dayId, dto);
  }

  @Patch('budgets/:id')
  @ApiReq('ITN-14', 'Edit a budget entry')
  @ApiParam({ name: 'id', description: 'Budget entry id' })
  @ApiOkResponse({ schema: { example: ENTRY_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Negative amount, unknown category or unsupported currency',
  })
  @ApiNotFoundResponse({
    description: 'Entry not found, or not in your itinerary',
  })
  updateEntry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateBudgetEntryDto,
  ): Promise<BudgetEntryView> {
    return this.budget.updateEntry(user, id, dto);
  }

  @Delete('budgets/:id')
  @HttpCode(204)
  @ApiReq('ITN-14', 'Delete a budget entry')
  @ApiParam({ name: 'id', description: 'Budget entry id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({
    description: 'Entry not found, or not in your itinerary',
  })
  deleteEntry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.budget.deleteEntry(user, id);
  }

  @Post('itineraries/:id/transport-costs')
  @ApiReq(
    'ITN-16',
    'Add a transport cost',
    'Mode (flight, train, bus, car, ferry, other), from-city and to-city (two different cities from the city list), a non-negative amount, a currency and the day it belongs to. It counts in the budget as intercity transport.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiCreatedResponse({ schema: { example: TRANSPORT_EXAMPLE } })
  @ApiBadRequestResponse({
    description:
      'Same city twice, unknown city, negative amount or unsupported currency',
  })
  @ApiNotFoundResponse({ description: 'Itinerary or day not found' })
  createTransport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateTransportCostDto,
  ): Promise<TransportCostView> {
    return this.budget.createTransport(user, id, dto);
  }

  @Patch('transport-costs/:id')
  @ApiReq('ITN-16', 'Edit a transport cost')
  @ApiParam({ name: 'id', description: 'Transport cost id' })
  @ApiOkResponse({ schema: { example: TRANSPORT_EXAMPLE } })
  @ApiBadRequestResponse({
    description:
      'Same city twice, unknown city, negative amount or unsupported currency',
  })
  @ApiNotFoundResponse({
    description: 'Entry not found, or not in your itinerary',
  })
  updateTransport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTransportCostDto,
  ): Promise<TransportCostView> {
    return this.budget.updateTransport(user, id, dto);
  }

  @Delete('transport-costs/:id')
  @HttpCode(204)
  @ApiReq('ITN-16', 'Delete a transport cost')
  @ApiParam({ name: 'id', description: 'Transport cost id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({
    description: 'Entry not found, or not in your itinerary',
  })
  deleteTransport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.budget.deleteTransport(user, id);
  }
}

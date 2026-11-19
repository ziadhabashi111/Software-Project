import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { RefundsService } from './refunds.service';
import type { RefundView } from './refunds.service';

/** HTTP only; the logic lives in `RefundsService`. */
@ApiTags('payments')
@ApiCookieAuth()
@Controller()
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get('refunds/:id')
  @Roles(Role.USER)
  @ApiParam({
    name: 'id',
    description: 'The refund id shown on the booking details (Stripe `re_...`)',
  })
  @ApiReq(
    'PAY-03',
    'Refund status',
    'Your own refund only; another user gets 404. Status is Pending, Refunded or Failed; Pending moves to its final state through the Stripe webhook.',
  )
  @ApiOkResponse({ description: 'Refund amount, currency and status' })
  @ApiNotFoundResponse({ description: 'Not your refund' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<RefundView> {
    return this.refunds.get(user.id, id);
  }
}

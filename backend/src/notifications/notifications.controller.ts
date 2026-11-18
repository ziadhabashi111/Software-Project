import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto, toPage } from '../common/pagination/pagination';
import type { Paginated } from '../common/pagination/pagination';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { toNotificationView } from './notification-view';
import type { NotificationView } from './notification-view';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiCookieAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiReq(
    'GEN-01',
    'My notifications',
    'Paginated list of the logged-in user only, newest first. Page size 10 by default (max 100).',
  )
  @ApiOkResponse({ description: 'One page of notifications' })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<NotificationView>> {
    const { items, total } = await this.notifications.findForUser(
      user.id,
      query.page,
      query.limit,
    );
    return toPage(items.map(toNotificationView), total, query);
  }

  @Get('unread-count')
  @ApiReq('GEN-01', 'Unread notification count')
  @ApiOkResponse({ description: 'How many notifications are still unread' })
  async unreadCount(@CurrentUser() user: AuthUser): Promise<{ count: number }> {
    return { count: await this.notifications.countUnread(user.id) };
  }

  @Patch('read-all')
  @ApiReq('GEN-01', 'Mark all notifications as read')
  @ApiOkResponse({ description: 'How many notifications were marked read' })
  async readAll(@CurrentUser() user: AuthUser): Promise<{ updated: number }> {
    return { updated: await this.notifications.markAllRead(user.id) };
  }

  @Patch(':id/read')
  @ApiReq(
    'GEN-01',
    'Mark one notification as read',
    'Only works on your own notifications; anyone else’s (or an unknown id) returns 404.',
  )
  @ApiOkResponse({ description: 'The updated notification' })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  async markRead(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<NotificationView> {
    return toNotificationView(await this.notifications.markRead(user.id, id));
  }
}

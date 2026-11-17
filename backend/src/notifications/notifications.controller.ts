import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import {
  NotificationPage,
  NotificationsService,
} from './notifications.service';
import type { NotificationDocument } from './schemas/notification.schema';

@ApiTags('notifications')
@ApiCookieAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiReq(
    'GEN-01',
    'My notifications',
    'Paginated list of the logged-in user only, newest first. Defaults: page 1, limit 20 (max 100).',
  )
  @ApiOkResponse({ description: 'One page of notifications' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationPage> {
    return this.notifications.findForUser(user.id, query.page, query.limit);
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
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<NotificationDocument> {
    return this.notifications.markRead(user.id, id);
  }
}

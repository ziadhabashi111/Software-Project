import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Role, type AuthUser } from '../../auth/auth.types';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ApiReq } from '../../common/swagger/api-req.decorator';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';
import type { ReportView } from './reports.service';

@ApiTags('reports')
@ApiCookieAuth()
@ApiForbiddenResponse({ description: 'Only registered users report content' })
@Roles(Role.USER)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @ApiReq(
    'GEN-09',
    'Report content',
    'A registered user reports a post, comment, review or itinerary with a reason (up to 500 characters). Each user can report the same item only once. The item must exist and be visible to the reporter, and users cannot report their own content. Administrators see open reports in GET /api/admin/reports (GEN-10).',
  )
  @ApiCreatedResponse({
    schema: {
      example: {
        id: '6650f1c2a1b2c3d4e5f60aaa',
        contentType: 'post',
        contentId: '6650f1c2a1b2c3d4e5f60789',
        reason: 'Spam: the post only advertises a website',
        status: 'open',
        createdAt: '2026-11-18T10:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid type, id or reason, or reporting your own content',
  })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiNotFoundResponse({
    description: 'The item does not exist or is not visible to you',
  })
  @ApiConflictResponse({ description: 'You have already reported this item' })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateReportDto,
  ): Promise<ReportView> {
    return this.reports.submit(user, dto);
  }
}

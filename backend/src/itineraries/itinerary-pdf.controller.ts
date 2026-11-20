import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { BudgetSummaryQueryDto } from './budget/dto/budget-summary-query.dto';
import { ItineraryPdfService } from './itinerary-pdf.service';

/**
 * ITN-28 (optional bonus): download an itinerary as a PDF. Open to visitors
 * (`@Public()`) because a public itinerary can be printed by anyone, but the
 * service decides what each caller may see: the owner gets the full PDF, every
 * other caller only the public copy, and anything else is a 404.
 */
@ApiTags('itineraries')
@ApiCookieAuth()
@Controller('itineraries/:id/pdf')
export class ItineraryPdfController {
  constructor(private readonly pdf: ItineraryPdfService) {}

  @Get()
  @Public()
  @ApiReq(
    'ITN-28',
    'Download an itinerary as a PDF (optional bonus)',
    'Your own itinerary as a PDF: title, dates, the numbered days with their activities, the bookings you linked to its days (ITN-27) and your budget summary in `currency` (your preferred currency when omitted). Anyone else, signed in or not, can download only a public itinerary that a moderator has not hidden, and gets the public copy: the author, the days and the public budget, never linked bookings. A private, hidden or unknown itinerary is a 404. If exchange rates are unavailable the PDF is still produced, without the budget.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'A PDF file download' })
  @ApiBadRequestResponse({
    description: 'Malformed id or unsupported currency',
  })
  @ApiNotFoundResponse({
    description: 'Not found, or neither yours nor public',
  })
  async download(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: BudgetSummaryQueryDto,
    @Res({ passthrough: true }) response: Response,
    @CurrentUser() viewer?: AuthUser,
  ): Promise<StreamableFile> {
    const { filename, pdf } = await this.pdf.pdf(viewer, id, query.currency);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    return new StreamableFile(pdf);
  }
}

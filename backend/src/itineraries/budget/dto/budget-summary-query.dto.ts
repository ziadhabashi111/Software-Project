import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';
import { CURRENCY_CODE, upper } from '../../dto/transforms';

/** Query for `GET /api/itineraries/:id/budget-summary` (ITN-14, ITN-18). */
export class BudgetSummaryQueryDto {
  @ApiPropertyOptional({
    example: 'EUR',
    description:
      'Show the totals in this currency instead of your preferred one',
  })
  @IsOptional()
  @Transform(upper)
  @Matches(CURRENCY_CODE, {
    message: 'Use a three-letter currency code such as USD',
  })
  currency?: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * FLT-26: cancel after seeing the refund. Without `confirm: true` nothing is
 * changed and the refund preview is returned.
 */
export class CancelFlightBookingDto {
  @ApiPropertyOptional({
    example: true,
    description:
      'Send true to cancel. Leave it out to see the refund amount first.',
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

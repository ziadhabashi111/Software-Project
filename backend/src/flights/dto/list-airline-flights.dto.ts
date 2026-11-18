import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { FlightStatus } from '../flight-status';

/** Query for `GET /api/airlines/:id/flights` (FLT-05). */
export class ListAirlineFlightsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: FlightStatus,
    description:
      'Only flights with this status. Departed also covers Scheduled flights whose departure time has passed.',
  })
  @IsOptional()
  @IsEnum(FlightStatus)
  status?: FlightStatus;
}

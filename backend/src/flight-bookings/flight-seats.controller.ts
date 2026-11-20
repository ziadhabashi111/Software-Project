import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { SeatMapQueryDto } from './dto/seat.dto';
import { SeatMapView, SeatSelectionService } from './seat-selection.service';

/** FLT-28: the seat map, public like the flight details (FLT-17). */
@ApiTags('flight-bookings')
@Controller('flights')
export class FlightSeatsController {
  constructor(private readonly seats: SeatSelectionService) {}

  @Get(':id/seats')
  @Public()
  @ApiParam({ name: 'id', description: 'Flight id' })
  @ApiReq(
    'FLT-28',
    'Seat map of a cabin',
    'Every seat of the cabin by row (rows from 1, letters from A; the last row may be partial) and whether it is taken. Who sits where is never shown. 404 when the flight has no such cabin.',
  )
  @ApiOkResponse({
    schema: {
      example: {
        flightId: '6650f1c2a1b2c3d4e5f60789',
        cabinClass: 'Economy',
        seatsPerRow: 6,
        totalSeats: 10,
        rows: [
          {
            row: 1,
            seats: [
              { label: '1A', taken: false },
              { label: '1B', taken: true },
            ],
          },
        ],
      },
    },
  })
  @ApiNotFoundResponse({ description: 'No such flight or cabin' })
  seatMap(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: SeatMapQueryDto,
  ): Promise<SeatMapView> {
    return this.seats.seatMap(id, query.cabinClass);
  }
}

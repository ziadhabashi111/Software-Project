import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import type { Paginated } from '../common/pagination/pagination';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { AirportsService } from './airports.service';
import type { AirportView } from './airports.service';
import { ListAirportsQueryDto } from './dto/list-airports.dto';

@ApiTags('airports')
@Controller('airports')
export class AirportsController {
  constructor(private readonly airports: AirportsService) {}

  @Get()
  @Public()
  @ApiReq(
    'FLT-02',
    'List airports',
    'Read-only reference list loaded at setup (IATA code, name, city, country, IANA time zone). Flight creation and flight search accept only these airports. Paginated (page size 10 by default, up to 100).',
  )
  @ApiOkResponse({
    schema: {
      example: {
        items: [
          {
            iataCode: 'CAI',
            name: 'Cairo International Airport',
            cityId: 'cairo',
            countryCode: 'EG',
            timeZone: 'Africa/Cairo',
          },
        ],
        total: 8,
        page: 1,
        limit: 10,
      },
    },
  })
  list(@Query() query: ListAirportsQueryDto): Promise<Paginated<AirportView>> {
    return this.airports.list(query);
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import type { Paginated } from '../common/pagination/pagination';
import { ApiReq } from '../common/swagger/api-req.decorator';
import {
  ListCitiesQueryDto,
  ListCountriesQueryDto,
  ListCurrenciesQueryDto,
} from './dto/list-reference.dto';
import { ReferenceDataService } from './reference-data.service';
import type {
  CityView,
  CountryView,
  CurrencyView,
} from './reference-data.service';

/** GEN-12: read-only lists loaded by `npm run seed`. Public, like airports. */
@ApiTags('reference-data')
@Controller()
export class ReferenceDataController {
  constructor(private readonly referenceData: ReferenceDataService) {}

  @Get('countries')
  @Public()
  @ApiReq(
    'GEN-12',
    'List countries',
    'Predefined country list from the official dataset (code, name, currency), sorted by name. Use these codes wherever a country is "selected from a predefined list" (e.g. ITN-01). Paginated (page size 10 by default, up to 100).',
  )
  @ApiOkResponse({
    schema: {
      example: {
        items: [{ code: 'EG', name: 'Egypt', currency: 'EGP' }],
        total: 8,
        page: 1,
        limit: 10,
      },
    },
  })
  listCountries(
    @Query() query: ListCountriesQueryDto,
  ): Promise<Paginated<CountryView>> {
    return this.referenceData.listCountries(query);
  }

  @Get('cities')
  @Public()
  @ApiReq(
    'GEN-12',
    'List cities',
    'Predefined city list shared by hotels, airports and itinerary days (ITN-05), sorted by name. Filter by country with countryCode. Paginated (page size 10 by default, up to 100).',
  )
  @ApiOkResponse({
    schema: {
      example: {
        items: [{ cityId: 'cairo', name: 'Cairo', countryCode: 'EG' }],
        total: 1,
        page: 1,
        limit: 10,
      },
    },
  })
  listCities(@Query() query: ListCitiesQueryDto): Promise<Paginated<CityView>> {
    return this.referenceData.listCities(query);
  }

  @Get('currencies')
  @Public()
  @ApiReq(
    'GEN-12',
    'List supported currencies',
    'The supported currencies: the distinct currency codes of the countries dataset (PDF 5.1), with the countries using each. Paginated (page size 10 by default, up to 100).',
  )
  @ApiOkResponse({
    schema: {
      example: {
        items: [{ code: 'EUR', countryCodes: ['DE', 'FR'] }],
        total: 7,
        page: 1,
        limit: 10,
      },
    },
  })
  listCurrencies(
    @Query() query: ListCurrenciesQueryDto,
  ): Promise<Paginated<CurrencyView>> {
    return this.referenceData.listCurrencies(query);
  }
}

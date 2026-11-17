import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { QueryFilter, Model } from 'mongoose';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
import type { ListAirportsQueryDto } from './dto/list-airports.dto';
import { Airport } from './schemas/airport.schema';
import type { AirportDocument } from './schemas/airport.schema';

export interface AirportView {
  iataCode: string;
  name: string;
  cityId: string;
  countryCode: string;
  timeZone: string;
}

export function toAirportView(airport: AirportDocument): AirportView {
  return {
    iataCode: airport.iataCode,
    name: airport.name,
    cityId: airport.cityId,
    countryCode: airport.countryCode,
    timeZone: airport.timeZone,
  };
}

const escapeRegex = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** FLT-02: the read-only airport list. Flights and search accept only these. */
@Injectable()
export class AirportsService {
  constructor(
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
  ) {}

  async list(query: ListAirportsQueryDto): Promise<Paginated<AirportView>> {
    const filter: QueryFilter<Airport> = {};
    if (query.search) {
      const pattern = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [
        { iataCode: pattern },
        { name: pattern },
        { cityId: pattern },
      ];
    }
    const [items, total] = await Promise.all([
      this.airports
        .find(filter)
        .sort({ iataCode: 1 })
        .skip(skipFor(query))
        .limit(query.limit),
      this.airports.countDocuments(filter),
    ]);
    return toPage(items.map(toAirportView), total, query);
  }

  /** Used by flight creation and search to accept listed airports only. */
  findByCode(iataCode: string): Promise<AirportDocument | null> {
    return this.airports.findOne({ iataCode: iataCode.toUpperCase() });
  }

  findByCodes(iataCodes: string[]): Promise<AirportDocument[]> {
    return this.airports.find({
      iataCode: { $in: iataCodes.map((code) => code.toUpperCase()) },
    });
  }

  findByCity(cityId: string): Promise<AirportDocument[]> {
    return this.airports.find({ cityId });
  }
}

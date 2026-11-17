import type { PipelineStage, Types } from 'mongoose';
import { FlightSortBy, SortOrder } from './dto/search-flights.dto';
import type { CabinClass } from './flight-status';
import { FlightStatus } from './flight-status';

export interface FlightCriteria {
  departureAirports: string[];
  arrivalAirports: string[];
  /** Local date at the departure airport, `YYYY-MM-DD`. */
  date: string;
  /** Seats needed: adults + children (infants take no seat, FLT-12). */
  seats: number;
  cabinClass?: CabinClass;
  minPrice?: number;
  maxPrice?: number;
  sortBy: FlightSortBy;
  order: SortOrder;
  skip: number;
  limit: number;
  now: Date;
  activeAirlineIds: Types.ObjectId[];
}

const SORT_FIELD: Record<FlightSortBy, string> = {
  [FlightSortBy.PRICE]: 'fromPrice',
  [FlightSortBy.DURATION]: 'durationMs',
  [FlightSortBy.DEPARTURE]: 'departureUtc',
};

/**
 * FLT-11, FLT-12, FLT-15: Scheduled flights of active airlines on the local
 * date whose cabins have enough free seats (total - booked - held), optionally
 * limited to a cabin class and an inclusive price range. A flight is listed
 * with only the cabins that qualify, so the price filter and the "from" price
 * agree with what the user can pick.
 */
export function buildSearchPipeline(c: FlightCriteria): PipelineStage[] {
  const cabinConditions: Record<string, unknown>[] = [
    {
      $gte: [
        {
          $subtract: [
            '$$c.totalSeats',
            { $add: ['$$c.bookedSeats', '$$c.heldSeats'] },
          ],
        },
        c.seats,
      ],
    },
  ];
  if (c.cabinClass) {
    cabinConditions.push({ $eq: ['$$c.cabinClass', c.cabinClass] });
  }
  if (c.minPrice !== undefined) {
    cabinConditions.push({ $gte: ['$$c.price', c.minPrice] });
  }
  if (c.maxPrice !== undefined) {
    cabinConditions.push({ $lte: ['$$c.price', c.maxPrice] });
  }

  const direction = c.order === SortOrder.DESC ? -1 : 1;
  return [
    {
      $match: {
        status: FlightStatus.SCHEDULED,
        departureAirport: { $in: c.departureAirports },
        arrivalAirport: { $in: c.arrivalAirports },
        departureLocalDate: c.date,
        departureUtc: { $gt: c.now },
        airlineId: { $in: c.activeAirlineIds },
      },
    },
    {
      $addFields: {
        cabins: {
          $filter: {
            input: '$cabins',
            as: 'c',
            cond: { $and: cabinConditions },
          },
        },
      },
    },
    { $match: { 'cabins.0': { $exists: true } } },
    {
      $addFields: {
        fromPrice: { $min: '$cabins.price' },
        durationMs: { $subtract: ['$arrivalUtc', '$departureUtc'] },
      },
    },
    {
      $facet: {
        items: [
          { $sort: { [SORT_FIELD[c.sortBy]]: direction, _id: 1 } },
          { $skip: c.skip },
          { $limit: c.limit },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ];
}

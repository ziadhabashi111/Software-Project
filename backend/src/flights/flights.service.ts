import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model, QueryFilter } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { fieldError } from '../common/validation/validation-errors';
import { NOTIFICATION_SERVICE } from '../notifications/notification.service.interface';
import type { NotificationService } from '../notifications/notification.service.interface';
import { assertOwnAirline } from './airline-access';
import { AirlinesService } from './airlines.service';
import { AirportsService } from './airports.service';
import { CreateCabinDto } from './dto/create-cabin.dto';
import { CreateFlightDto } from './dto/create-flight.dto';
import { UpdateCabinDto } from './dto/update-cabin.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import { FlightBookingHooks } from './flight-booking-hooks';
import { assertDifferentAirports, assertValidSchedule } from './flight-rules';
import { effectiveStatus, FlightStatus } from './flight-status';
import { toFlightView } from './flight-view';
import type { FlightView } from './flight-view';
import type { AirportDocument } from './schemas/airport.schema';
import { Flight } from './schemas/flight.schema';
import type { FlightDocument } from './schemas/flight.schema';
import { localToUtc, utcToLocal } from './time-zones';

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

const flightNumberTaken = () =>
  fieldError(
    'flightNumber',
    'This airline already has a flight with this number on that departure date',
    409,
  );

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message,
    code,
  });
}

/** FLT-03, FLT-04, FLT-05, FLT-30: an airline moderator's flights and cabins. */
@Injectable()
export class FlightsService {
  private readonly logger = new Logger(FlightsService.name);

  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly airports: AirportsService,
    private readonly airlines: AirlinesService,
    private readonly bookings: FlightBookingHooks,
    @Optional()
    @Inject(NOTIFICATION_SERVICE)
    private readonly notifications?: NotificationService,
  ) {}

  /** FLT-03 */
  async create(user: AuthUser, dto: CreateFlightDto): Promise<FlightView> {
    const airlineId = user.providerId ?? '';
    assertOwnAirline(user, airlineId);

    assertDifferentAirports(dto.departureAirport, dto.arrivalAirport);
    const airports = await this.loadAirports(
      dto.departureAirport,
      dto.arrivalAirport,
    );
    const departure = airports.get(dto.departureAirport) as AirportDocument;
    const arrival = airports.get(dto.arrivalAirport) as AirportDocument;
    const departureUtc = this.toUtc(
      'departureTime',
      dto.departureTime,
      departure,
    );
    const arrivalUtc = this.toUtc('arrivalTime', dto.arrivalTime, arrival);
    assertValidSchedule(departureUtc, arrivalUtc);

    try {
      const flight = await this.flights.create({
        airlineId: new Types.ObjectId(airlineId),
        flightNumber: dto.flightNumber,
        departureAirport: dto.departureAirport,
        arrivalAirport: dto.arrivalAirport,
        departureUtc,
        arrivalUtc,
        departureLocalDate: utcToLocal(departureUtc, departure.timeZone).date,
      });
      return await this.view(flight);
    } catch (error) {
      if (isDuplicateKey(error)) throw flightNumberTaken();
      throw error;
    }
  }

  /** FLT-05: times, and airports until the flight has any booking. */
  async update(
    id: string,
    user: AuthUser,
    dto: UpdateFlightDto,
  ): Promise<FlightView> {
    const flight = await this.loadOwned(id, user);
    if (Object.values(dto).every((value) => value === undefined)) {
      throw fieldError('body', 'Send at least one field to change');
    }

    const departureCode = dto.departureAirport ?? flight.departureAirport;
    const arrivalCode = dto.arrivalAirport ?? flight.arrivalAirport;
    const airportsChanged =
      departureCode !== flight.departureAirport ||
      arrivalCode !== flight.arrivalAirport;
    if (airportsChanged && hasAnyBooking(flight)) {
      throw conflict(
        'AIRPORTS_LOCKED',
        'Airports cannot be changed once the flight has any booking',
      );
    }

    assertDifferentAirports(departureCode, arrivalCode);
    const airports = await this.loadAirports(departureCode, arrivalCode);
    const departure = airports.get(departureCode) as AirportDocument;
    const arrival = airports.get(arrivalCode) as AirportDocument;
    const departureUtc = dto.departureTime
      ? this.toUtc('departureTime', dto.departureTime, departure)
      : flight.departureUtc;
    const arrivalUtc = dto.arrivalTime
      ? this.toUtc('arrivalTime', dto.arrivalTime, arrival)
      : flight.arrivalUtc;
    assertValidSchedule(departureUtc, arrivalUtc);

    const filter: QueryFilter<Flight> = {
      _id: flight._id,
      status: FlightStatus.SCHEDULED,
    };
    if (airportsChanged) {
      // A hold or booking may have arrived since we loaded the flight.
      filter.everBooked = false;
      filter.cabins = {
        $not: {
          $elemMatch: {
            $or: [{ bookedSeats: { $gt: 0 } }, { heldSeats: { $gt: 0 } }],
          },
        },
      };
    }

    let updated: FlightDocument | null;
    try {
      updated = await this.flights.findOneAndUpdate(
        filter,
        {
          $set: {
            departureAirport: departureCode,
            arrivalAirport: arrivalCode,
            departureUtc,
            arrivalUtc,
            departureLocalDate: utcToLocal(departureUtc, departure.timeZone)
              .date,
          },
        },
        { returnDocument: 'after', runValidators: true },
      );
    } catch (error) {
      if (isDuplicateKey(error)) throw flightNumberTaken();
      throw error;
    }
    if (!updated) {
      throw conflict(
        'FLIGHT_CHANGED',
        'The flight changed while you were editing it (a booking was made or its status changed). Reload it and try again.',
      );
    }

    const timesChanged =
      departureUtc.getTime() !== flight.departureUtc.getTime() ||
      arrivalUtc.getTime() !== flight.arrivalUtc.getTime();
    if (timesChanged) {
      await this.notifyTimeChange(updated, departure, arrival);
    }
    return this.view(updated);
  }

  /** FLT-04 */
  async addCabin(
    id: string,
    user: AuthUser,
    dto: CreateCabinDto,
  ): Promise<FlightView> {
    const flight = await this.loadOwned(id, user);
    const updated = await this.flights.findOneAndUpdate(
      {
        _id: flight._id,
        status: FlightStatus.SCHEDULED,
        'cabins.cabinClass': { $ne: dto.cabinClass },
      },
      {
        $push: {
          cabins: {
            cabinClass: dto.cabinClass,
            totalSeats: dto.seats,
            bookedSeats: 0,
            heldSeats: 0,
            price: dto.price,
            freeBags: dto.freeBags,
            maxBagWeightKg: dto.maxBagWeightKg,
          },
        },
      },
      { returnDocument: 'after', runValidators: true },
    );
    if (!updated) {
      if (flight.cabins.some((c) => c.cabinClass === dto.cabinClass)) {
        throw fieldError(
          'cabinClass',
          `This flight already has a ${dto.cabinClass} cabin`,
          409,
        );
      }
      throw conflict(
        'FLIGHT_CHANGED',
        'The flight is no longer Scheduled, so it cannot be edited',
      );
    }
    return this.view(updated);
  }

  /** FLT-04, FLT-05: price and seats of one cabin (existing bookings keep their price). */
  async updateCabin(
    id: string,
    cabinId: string,
    user: AuthUser,
    dto: UpdateCabinDto,
  ): Promise<FlightView> {
    const flight = await this.loadOwned(id, user);
    const cabin = flight.cabins.find((c) => c._id.toString() === cabinId);
    if (!cabin) throw new NotFoundException('Cabin not found');

    const set: Record<string, number> = {};
    if (dto.seats !== undefined) set['cabins.$[c].totalSeats'] = dto.seats;
    if (dto.price !== undefined) set['cabins.$[c].price'] = dto.price;
    if (dto.freeBags !== undefined) set['cabins.$[c].freeBags'] = dto.freeBags;
    if (dto.maxBagWeightKg !== undefined) {
      set['cabins.$[c].maxBagWeightKg'] = dto.maxBagWeightKg;
    }
    if (Object.keys(set).length === 0) {
      throw fieldError('body', 'Send at least one field to change');
    }

    const cabinObjectId = new Types.ObjectId(cabinId);
    const filter: QueryFilter<Flight> = {
      _id: flight._id,
      status: FlightStatus.SCHEDULED,
    };
    if (dto.seats !== undefined) {
      // Atomic with booking holds: the new total must cover booked + held.
      filter.$expr = {
        $gt: [
          {
            $size: {
              $filter: {
                input: '$cabins',
                as: 'c',
                cond: {
                  $and: [
                    { $eq: ['$$c._id', cabinObjectId] },
                    {
                      $lte: [
                        { $add: ['$$c.bookedSeats', '$$c.heldSeats'] },
                        dto.seats,
                      ],
                    },
                  ],
                },
              },
            },
          },
          0,
        ],
      };
    } else {
      filter['cabins._id'] = cabinObjectId;
    }

    const updated = await this.flights.findOneAndUpdate(
      filter,
      { $set: set },
      {
        returnDocument: 'after',
        runValidators: true,
        arrayFilters: [{ 'c._id': cabinObjectId }],
      },
    );
    if (!updated) {
      const taken = cabin.bookedSeats + cabin.heldSeats;
      if (dto.seats !== undefined && dto.seats < taken) {
        throw conflict(
          'SEATS_BELOW_BOOKED',
          `Seat count cannot be below the ${taken} seats already booked or held`,
        );
      }
      throw conflict(
        'FLIGHT_CHANGED',
        'The flight changed while you were editing it. Reload it and try again.',
      );
    }
    return this.view(updated);
  }

  /** FLT-30: persist Departed once the departure time has passed (also computed on read). */
  @Cron(CronExpression.EVERY_MINUTE)
  async markDeparted(): Promise<void> {
    try {
      await this.flights.updateMany(
        {
          status: FlightStatus.SCHEDULED,
          departureUtc: { $lte: new Date() },
        },
        { $set: { status: FlightStatus.DEPARTED } },
      );
    } catch (error) {
      this.logger.error(
        'Could not mark departed flights',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Builds the shared flight view (airline and both airports looked up). */
  async view(flight: FlightDocument): Promise<FlightView> {
    const [airline, airports] = await Promise.all([
      this.airlines.findForFlights(flight.airlineId.toString(), {
        includeInactive: true,
      }),
      this.airports.findByCodes([
        flight.departureAirport,
        flight.arrivalAirport,
      ]),
    ]);
    const byCode = new Map(airports.map((a) => [a.iataCode, a]));
    const departure = byCode.get(flight.departureAirport);
    const arrival = byCode.get(flight.arrivalAirport);
    if (!airline || !departure || !arrival) {
      throw new NotFoundException('Flight data is incomplete');
    }
    return toFlightView(flight, airline, departure, arrival);
  }

  /** Loads a flight the moderator owns, and requires it to be Scheduled (FLT-30). */
  private async loadOwned(id: string, user: AuthUser): Promise<FlightDocument> {
    const flight = await this.flights.findById(id);
    if (!flight) throw new NotFoundException('Flight not found');
    assertOwnAirline(user, flight.airlineId.toString());
    if (effectiveStatus(flight) !== FlightStatus.SCHEDULED) {
      throw conflict(
        'FLIGHT_NOT_SCHEDULED',
        `Only Scheduled flights can be edited (this flight is ${effectiveStatus(flight)})`,
      );
    }
    return flight;
  }

  private async loadAirports(
    ...codes: string[]
  ): Promise<Map<string, AirportDocument>> {
    const found = await this.airports.findByCodes(codes);
    const byCode = new Map(found.map((a) => [a.iataCode, a]));
    const fields = ['departureAirport', 'arrivalAirport'];
    codes.forEach((code, index) => {
      if (!byCode.has(code)) {
        throw fieldError(
          fields[index] ?? 'airport',
          `${code} is not in the airport list (see GET /api/airports)`,
        );
      }
    });
    return byCode;
  }

  private toUtc(field: string, local: string, airport: AirportDocument): Date {
    const utc = localToUtc(local, airport.timeZone);
    if (!utc) {
      throw fieldError(
        field,
        `That local time does not exist at ${airport.iataCode} (${airport.timeZone})`,
      );
    }
    return utc;
  }

  /** FLT-05: tell passengers with Confirmed bookings. Best effort, the change is already saved. */
  private async notifyTimeChange(
    flight: FlightDocument,
    departure: AirportDocument,
    arrival: AirportDocument,
  ): Promise<void> {
    const link = this.bookings.get();
    const notifications = this.notifications;
    if (!notifications || !link) return;
    try {
      const userIds = await link.getConfirmedPassengerUserIds(flight.id);
      const out = utcToLocal(flight.departureUtc, departure.timeZone);
      const back = utcToLocal(flight.arrivalUtc, arrival.timeZone);
      const message = `The times of flight ${flight.flightNumber} (${departure.iataCode} to ${arrival.iataCode}) changed. It now departs ${out.date} ${out.time} (${departure.iataCode} time) and arrives ${back.date} ${back.time} (${arrival.iataCode} time).`;
      await Promise.all(
        userIds.map((userId) =>
          notifications.notify(userId, 'FLIGHT_TIME_CHANGED', message),
        ),
      );
    } catch (error) {
      this.logger.error(
        'Could not send the flight time change notification',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

/** FLT-05: any booking or hold, past or present, locks the airports. */
function hasAnyBooking(flight: FlightDocument): boolean {
  return (
    flight.everBooked ||
    flight.cabins.some((c) => c.bookedSeats > 0 || c.heldSeats > 0)
  );
}

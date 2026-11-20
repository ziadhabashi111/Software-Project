import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateBudgetEntryDto } from '../../itineraries/budget/dto/update-budget-entry.dto';
import { UpdateTransportCostDto } from '../../itineraries/budget/dto/update-transport-cost.dto';
import { UpdateActivityDto } from '../../itineraries/dto/update-activity.dto';
import { UpdateDayDto } from '../../itineraries/dto/update-day.dto';
import { UpdateItineraryDto } from '../../itineraries/dto/update-itinerary.dto';
import { UpdateProfileDto } from '../../users/dto/update-profile.dto';
import { UpdatePostDto } from '../../blog/dto/post.dto';
import { UpdateAirlineDto } from '../../flights/dto/update-airline.dto';
import { UpdateCabinDto } from '../../flights/dto/update-cabin.dto';
import { UpdateFlightDto } from '../../flights/dto/update-flight.dto';
import { UpdateReviewDto } from '../../hotel-bookings/dto/review.dto';
import { UpdateRoomDto } from '../../hotels/dto/create-room.dto';
import { UpdateHotelDto } from '../../hotels/dto/update-hotel.dto';

type DtoClass = new () => object;

function invalidFields(cls: DtoClass, body: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(cls, body)).map((e) => e.property);
}

/**
 * GEN-13 / GEN-02: on PATCH, leaving a field out keeps it, but sending
 * `null` for a field that cannot be empty is a 400 field error, never a
 * saved null or a 500 from Mongoose.
 */
describe('update DTOs reject null for required fields (GEN-13)', () => {
  const cases: [string, DtoClass, string[]][] = [
    [
      'UpdateItineraryDto',
      UpdateItineraryDto,
      ['title', 'countries', 'startDate', 'visibility'],
    ],
    ['UpdateDayDto', UpdateDayDto, ['city']],
    ['UpdateActivityDto', UpdateActivityDto, ['name']],
    ['UpdateProfileDto', UpdateProfileDto, ['name', 'preferredCurrency']],
    [
      'UpdateBudgetEntryDto',
      UpdateBudgetEntryDto,
      ['category', 'amount', 'currency', 'note'],
    ],
    [
      'UpdateTransportCostDto',
      UpdateTransportCostDto,
      ['dayId', 'mode', 'fromCity', 'toCity', 'amount', 'currency'],
    ],
    ['UpdatePostDto', UpdatePostDto, ['title', 'body', 'tags', 'status']],
    ['UpdateAirlineDto', UpdateAirlineDto, ['name', 'code']],
    [
      'UpdateCabinDto',
      UpdateCabinDto,
      ['seats', 'price', 'freeBags', 'maxBagWeightKg'],
    ],
    [
      'UpdateFlightDto',
      UpdateFlightDto,
      ['departureAirport', 'arrivalAirport', 'departureTime', 'arrivalTime'],
    ],
    ['UpdateReviewDto', UpdateReviewDto, ['rating']],
    [
      'UpdateHotelDto',
      UpdateHotelDto,
      [
        'name',
        'address',
        'city',
        'country',
        'description',
        'starClass',
        'amenities',
      ],
    ],
    [
      'UpdateRoomDto',
      UpdateRoomDto,
      ['type', 'beds', 'maxOccupancy', 'pricePerNight'],
    ],
  ];

  it.each(cases)('%s: null is a field error', (_name, cls, fields) => {
    for (const field of fields) {
      expect(invalidFields(cls, { [field]: null })).toEqual([field]);
    }
  });

  it.each(cases)('%s: an empty body is still valid', (_name, cls) => {
    expect(invalidFields(cls, {})).toEqual([]);
  });

  it('keeps the documented nullable fields clearable', () => {
    expect(invalidFields(UpdateDayDto, { notes: null })).toEqual([]);
    expect(invalidFields(UpdateProfileDto, { phone: null })).toEqual([]);
    expect(
      invalidFields(UpdateActivityDto, {
        description: null,
        time: null,
        cost: null,
        currency: null,
      }),
    ).toEqual([]);
  });

  it('names the field in the message', () => {
    const [error] = validateSync(plainToInstance(UpdateDayDto, { city: null }));
    expect(Object.values(error.constraints ?? {}).join(' ')).toMatch(/city/);
  });
});

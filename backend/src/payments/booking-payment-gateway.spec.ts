import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { FlightBookingPayments } from '../flight-bookings/flight-booking-payments';
import type { HotelInventoryRegistry } from '../hotel-bookings/hotel-inventory';
import type { HotelReservationPayments } from '../hotel-bookings/hotel-reservation-payments';
import { BookingPaymentGateway } from './booking-payment-gateway';

const USER = new Types.ObjectId().toString();
const HOTEL = new Types.ObjectId();
const RESERVATION = new Types.ObjectId().toString();

function reservationDoc(owner = USER) {
  return {
    user: new Types.ObjectId(owner),
    hotel: HOTEL,
    checkIn: new Date('2026-12-10T00:00:00Z'),
    checkOut: new Date('2026-12-12T00:00:00Z'),
    cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
  };
}

function setup(hotel: unknown, registered = true) {
  const reservations = {
    findById: jest.fn().mockResolvedValue(reservationDoc()),
  };
  const findHotel = jest.fn().mockResolvedValue(hotel);
  const inventory = {
    get: jest.fn().mockReturnValue(registered ? { findHotel } : undefined),
  };
  const gateway = new BookingPaymentGateway(
    {} as FlightBookingPayments,
    {} as HotelReservationPayments,
    reservations as never,
    inventory as unknown as HotelInventoryRegistry,
  );
  return { gateway, reservations, findHotel };
}

describe('BookingPaymentGateway.policies for hotels (PAY-02)', () => {
  it("shows the stay dates and the hotel's check-in and check-out times", async () => {
    const { gateway, findHotel } = setup({
      id: HOTEL.toString(),
      checkInTime: '14:00',
      checkOutTime: '12:00',
    });
    const view = await gateway.policies('hotel', RESERVATION, USER);
    expect(findHotel).toHaveBeenCalledWith(HOTEL.toString());
    expect(view.stay).toEqual({
      checkIn: new Date('2026-12-10T00:00:00Z'),
      checkOut: new Date('2026-12-12T00:00:00Z'),
      checkInTime: '14:00',
      checkOutTime: '12:00',
    });
    expect(view.cancellationTiers).toEqual([
      { daysBefore: 7, refundPercent: 50 },
    ]);
  });

  it('is a 404 when the hotel cannot be found', async () => {
    const { gateway } = setup(null);
    await expect(
      gateway.policies('hotel', RESERVATION, USER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is a 404 when the hotels module is not registered', async () => {
    const { gateway } = setup(null, false);
    await expect(
      gateway.policies('hotel', RESERVATION, USER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("is a 404 for someone else's reservation, before reading the hotel", async () => {
    const { gateway, findHotel } = setup({ id: HOTEL.toString() });
    await expect(
      gateway.policies('hotel', RESERVATION, new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findHotel).not.toHaveBeenCalled();
  });
});

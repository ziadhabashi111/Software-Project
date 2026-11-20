import PDFDocument from 'pdfkit';
import { PassengerType } from '../../flights/passenger-rules';
import type { FlightBookingView } from '../flight-booking-view';

type Passenger = FlightBookingView['passengers'][number];

/** FLT-28: the passenger's seat line on the e-ticket. */
export function seatText(
  view: FlightBookingView,
  passenger: Passenger,
): string {
  if (passenger.type === PassengerType.INFANT) {
    return 'No seat (infant on lap)';
  }
  const label = (seat: string | null | undefined) => seat ?? 'not selected';
  if (view.segments.length < 2) return `Seat ${label(passenger.seats[0])}`;
  return `Seats: outbound ${label(passenger.seats[0])}, return ${label(passenger.seats[1])}`;
}

/**
 * FLT-23: the downloadable e-ticket. Every time is printed in the airport's
 * local time with its UTC offset and zone (GEN-06).
 */
export function renderETicket(view: FlightBookingView): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(22).text('E-ticket', { align: 'left' });
    doc.moveDown(0.3);
    doc
      .fontSize(12)
      .text(`Booking reference: ${view.reference ?? '-'}`)
      .text(`Status: ${view.statusLabel}`)
      .text(
        `Trip: ${view.tripType === 'round-trip' ? 'Round trip' : 'One way'}`,
      );

    view.segments.forEach((segment, i) => {
      doc.moveDown();
      const label =
        view.segments.length > 1 ? (i === 0 ? 'Outbound' : 'Return') : 'Flight';
      doc
        .fontSize(14)
        .text(`${label}: ${segment.airline.name} ${segment.flightNumber}`);
      doc
        .fontSize(11)
        .text(
          `Departs ${segment.departure.airport.iataCode} ${segment.departure.airport.name}: ${segment.departure.localDate} ${segment.departure.localTime} (UTC${segment.departure.utcOffset}, ${segment.departure.airport.timeZone})`,
        )
        .text(
          `Arrives ${segment.arrival.airport.iataCode} ${segment.arrival.airport.name}: ${segment.arrival.localDate} ${segment.arrival.localTime} (UTC${segment.arrival.utcOffset}, ${segment.arrival.airport.timeZone})`,
        )
        .text(
          `Cabin: ${segment.cabinClass}. Free bags: ${segment.freeBags} per passenger, up to ${segment.maxBagWeightKg} kg each.`,
        );
    });

    doc.moveDown();
    doc.fontSize(14).text('Passengers');
    doc.fontSize(11);
    for (const p of view.passengers) {
      const bags =
        p.extraBags > 0
          ? `, ${p.extraBags} extra bag${p.extraBags === 1 ? '' : 's'}${p.extraBagWeightKg ? ` (${p.extraBagWeightKg} kg)` : ''}`
          : '';
      doc.text(
        `${p.fullName} (${p.type}), document ${p.documentNumber}${bags}. ${seatText(view, p)}`,
      );
    }

    doc.moveDown();
    doc
      .fontSize(12)
      .text(`Total paid: ${view.price.total.toFixed(2)} ${view.currency}`);
    doc.end();
  });
}

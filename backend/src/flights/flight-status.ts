/** FLT-30 */
export enum FlightStatus {
  SCHEDULED = 'Scheduled',
  CANCELLED = 'Cancelled',
  DEPARTED = 'Departed',
}

/** FLT-04: the fixed set of cabin categories. */
export enum CabinClass {
  ECONOMY = 'Economy',
  PREMIUM_ECONOMY = 'Premium Economy',
  BUSINESS = 'Business',
  FIRST = 'First',
}

/**
 * A Scheduled flight becomes Departed once its departure time has passed.
 * Computed on read so it is right even between runs of the scheduled job.
 */
export function effectiveStatus(
  flight: { status: FlightStatus; departureUtc: Date },
  now: Date = new Date(),
): FlightStatus {
  if (
    flight.status === FlightStatus.SCHEDULED &&
    flight.departureUtc.getTime() <= now.getTime()
  ) {
    return FlightStatus.DEPARTED;
  }
  return flight.status;
}

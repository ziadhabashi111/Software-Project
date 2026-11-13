/** Shared input clean-up and patterns for the itinerary DTOs. */
export const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const upper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export const lower = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const upperEach = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value.map((item: unknown) =>
        typeof item === 'string' ? item.trim().toUpperCase() : item,
      )
    : value;

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const COUNTRY_CODE = /^[A-Z]{2}$/;
export const CITY_ID = /^[a-z0-9][a-z0-9_-]{0,59}$/;
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
export const CURRENCY_CODE = /^[A-Z]{3}$/;

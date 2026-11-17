/** ITN-14: the four budget categories of a day. Activity costs count under `activities`. */
export enum BudgetCategory {
  FOOD = 'food',
  ACCOMMODATION = 'accommodation',
  IN_CITY_TRANSPORT = 'in_city_transport',
  ACTIVITIES = 'activities',
}

/** ITN-16: how the traveller gets from one city to the next. */
export enum TransportMode {
  FLIGHT = 'flight',
  TRAIN = 'train',
  BUS = 'bus',
  CAR = 'car',
  FERRY = 'ferry',
  OTHER = 'other',
}

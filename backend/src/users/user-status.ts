export enum UserStatus {
  ACTIVE = 'active',
  /** Admin suspended the account: cannot log in, bookings stay valid (ACC-16). */
  SUSPENDED = 'suspended',
  /** The user deactivated their own account (ACC-12). */
  DEACTIVATED = 'deactivated',
}

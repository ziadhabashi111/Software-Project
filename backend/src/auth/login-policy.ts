const MINUTE = 60 * 1000;

/** ACC-05: lock the account after this many consecutive failed logins... */
export const MAX_FAILED_LOGINS = 5;
/** ...for this long. */
export const LOCK_DURATION_MS = 15 * MINUTE;
export const LOCK_DURATION_MINUTES = LOCK_DURATION_MS / MINUTE;

/** ACC-06: a session with no authenticated request for this long expires. */
export const SESSION_IDLE_LIMIT_MS = 30 * MINUTE;
/** Activity is written at most this often (not on every request). */
export const SESSION_TOUCH_INTERVAL_MS = 1 * MINUTE;

/**
 * ACC-06: two tabs share the refresh cookie, so they can refresh with the same
 * token at the same moment. For this long after a rotation the just-replaced
 * token is still accepted (and answered with the current one) instead of
 * being treated as a stolen, replayed token.
 */
export const REFRESH_REUSE_GRACE_MS = 30 * 1000;

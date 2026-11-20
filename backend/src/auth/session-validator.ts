/** Injection token for the session store used by `AuthGuard`. */
export const SESSION_VALIDATOR = 'SESSION_VALIDATOR';

export interface SessionValidator {
  /**
   * True when the session is alive. Also counts the call as activity, so a
   * session expires after 30 minutes without an authenticated request.
   */
  validateAndTouch(sessionId: string, userId?: string): Promise<boolean>;
}

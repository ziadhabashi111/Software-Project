import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SESSION_VALIDATOR } from '../session-validator';
import { Session, SessionSchema } from './session.schema';
import { SessionService } from './session.service';

/**
 * Global: gives `AuthGuard` the session store (inactivity expiry, revocation)
 * and lets the admin module revoke sessions when it suspends an account.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Session.name, schema: SessionSchema }]),
  ],
  providers: [
    SessionService,
    { provide: SESSION_VALIDATOR, useExisting: SessionService },
  ],
  exports: [SessionService, SESSION_VALIDATOR],
})
export class SessionModule {}

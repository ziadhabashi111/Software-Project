import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { fieldError } from '../common/validation/validation-errors';
import { UserDocument } from '../users/schemas/user.schema';
import { toProfile, UserProfile } from '../users/user-profile';
import { UserStatus } from '../users/user-status';
import { UsersService } from '../users/users.service';
import type { AuthUser } from './auth.types';
import { Role } from './auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { LOCK_DURATION_MINUTES } from './login-policy';
import { PasswordService } from './password.service';
import { SessionService } from './sessions/session.service';
import { TokenService } from './token.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResult {
  user: UserProfile;
  tokens: AuthTokens;
  mustChangePassword: boolean;
}

const INVALID_CREDENTIALS = 'Invalid email or password';

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

@Injectable()
export class AuthService implements OnModuleInit {
  /** Compared against when the email is unknown, so timing does not reveal it. */
  private dummyHash = '';

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.passwords.hash(randomUUID());
  }

  /** ACC-01: a guest registers as a regular user. Admins are seeded, never registered. */
  async register(dto: RegisterDto): Promise<UserProfile> {
    if (await this.users.findByEmail(dto.email)) throw this.emailTaken();
    try {
      const user = await this.users.create({
        name: dto.name.trim(),
        email: dto.email,
        passwordHash: await this.passwords.hash(dto.password),
        role: Role.USER,
        consentAcceptedAt: new Date(),
      });
      return toProfile(user);
    } catch (error) {
      if (isDuplicateKey(error)) throw this.emailTaken();
      throw error;
    }
  }

  /** ACC-04, ACC-05. */
  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.users.findByEmailWithPassword(dto.email);
    if (!user) {
      await this.passwords.compare(dto.password, this.dummyHash);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
      throw this.locked();
    }

    const passwordOk = await this.passwords.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordOk) {
      const { locked } = await this.users.recordFailedLogin(user.id);
      throw locked
        ? this.locked()
        : new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('Your account is suspended');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    await this.users.resetLoginFailures(user.id);
    return this.startSession(user);
  }

  /** Swaps a valid refresh token for new tokens; the old refresh token stops working. */
  async refresh(refreshToken: string | undefined): Promise<AuthTokens> {
    if (!refreshToken) throw new UnauthorizedException('Not logged in');
    const { user: claims, jti } = this.tokens.verifyRefreshToken(refreshToken);
    const sessionId = claims.sessionId;
    if (!sessionId) throw new UnauthorizedException('Invalid token');

    const user = await this.users.findById(claims.id);
    if (!user || user.status !== UserStatus.ACTIVE) {
      await this.sessions.revoke(sessionId);
      throw new UnauthorizedException('Session expired');
    }

    const newJti = randomUUID();
    if (!(await this.sessions.rotate(sessionId, jti, newJti))) {
      throw new UnauthorizedException('Session expired');
    }
    return this.issueTokens(user, sessionId, newJti);
  }

  /** ACC-06: revokes the session on the server. Never fails: logging out twice is fine. */
  async logout(
    refreshToken: string | undefined,
    current: AuthUser | undefined,
  ): Promise<void> {
    const sessionIds = new Set<string>();
    if (current?.sessionId) sessionIds.add(current.sessionId);
    if (refreshToken) {
      try {
        const { user } = this.tokens.verifyRefreshToken(refreshToken);
        if (user.sessionId) sessionIds.add(user.sessionId);
      } catch {
        // an expired or invalid refresh token has nothing left to revoke
      }
    }
    await Promise.all([...sessionIds].map((id) => this.sessions.revoke(id)));
  }

  async me(current: AuthUser): Promise<UserProfile> {
    const user = await this.users.findById(current.id);
    if (!user) throw new UnauthorizedException('Not logged in');
    return toProfile(user);
  }

  /** ACC-08: signs out every other device and gives this one fresh tokens. */
  async changePassword(
    current: AuthUser,
    dto: ChangePasswordDto,
  ): Promise<AuthTokens> {
    const stored = await this.users.findByIdWithPassword(current.id);
    if (!stored) throw new UnauthorizedException('Not logged in');

    const currentOk = await this.passwords.compare(
      dto.currentPassword,
      stored.passwordHash,
    );
    if (!currentOk) {
      throw fieldError('currentPassword', 'Current password is incorrect');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw fieldError(
        'newPassword',
        'New password must be different from the current password',
      );
    }

    await this.users.setPassword(
      current.id,
      await this.passwords.hash(dto.newPassword),
      false,
    );
    await this.sessions.revokeAllForUser(current.id);

    const updated = await this.users.findById(current.id);
    if (!updated) throw new UnauthorizedException('Not logged in');
    return (await this.startSession(updated)).tokens;
  }

  private async startSession(user: UserDocument): Promise<LoginResult> {
    const jti = randomUUID();
    const session = await this.sessions.create(user.id, jti);
    return {
      user: toProfile(user),
      tokens: this.issueTokens(user, session.id, jti),
      mustChangePassword: user.mustChangePassword,
    };
  }

  private issueTokens(
    user: UserDocument,
    sessionId: string,
    jti: string,
  ): AuthTokens {
    const claims: AuthUser = {
      id: user.id,
      role: user.role,
      sessionId,
      ...(user.providerId ? { providerId: user.providerId.toString() } : {}),
      ...(user.mustChangePassword ? { mustChangePassword: true } : {}),
    };
    return {
      accessToken: this.tokens.signAccessToken(claims),
      refreshToken: this.tokens.signRefreshToken(claims, jti),
    };
  }

  private emailTaken(): HttpException {
    return fieldError('email', 'Email is already registered', 409);
  }

  private locked(): HttpException {
    return new HttpException(
      `Too many failed login attempts. Your account is locked for ${LOCK_DURATION_MINUTES} minutes.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

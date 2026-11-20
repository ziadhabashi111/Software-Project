import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiReq } from '../common/swagger/api-req.decorator';
import type { UserProfile } from '../users/user-profile';
import { AuthCookiesService } from './auth-cookies.service';
import { REFRESH_COOKIE } from './auth.constants';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest, AuthUser } from './auth.types';
import { AllowPasswordChange } from './decorators/allow-password-change.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { EmailVerificationService } from './email-verification.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailQueryDto } from './dto/verify-email-query.dto';
import {
  PasswordResetService,
  RESET_LINK_TTL_MINUTES,
} from './password-reset.service';

function readCookie(req: Request, name: string): string | undefined {
  return (req.cookies as Record<string, string> | undefined)?.[name];
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly emailVerification: EmailVerificationService,
    private readonly cookies: AuthCookiesService,
  ) {}

  @Public()
  @Post('register')
  @ApiReq(
    'ACC-01',
    'Register a new user',
    'A guest registers with name, unique email, a password (8+ characters with a letter and a digit) and the mandatory terms and privacy consent. The account is always a regular user: admins are seeded and moderators are created by an admin.',
  )
  @ApiConflictResponse({ description: 'Email is already registered' })
  register(@Body() dto: RegisterDto): Promise<UserProfile> {
    return this.auth.register(dto);
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  @ApiReq(
    ['ACC-04', 'ACC-05', 'ACC-19'],
    'Log in',
    'Sets the httpOnly access_token (short-lived) and refresh_token cookies; no token is returned in the body. Wrong credentials always give the generic "Invalid email or password". The 5th consecutive failure locks the account for 15 minutes (429). A suspended account sees "Your account is suspended" (403).',
  )
  @ApiOkResponse({ description: 'Logged in; the cookies are set' })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiForbiddenResponse({ description: 'Your account is suspended' })
  @ApiTooManyRequestsResponse({ description: 'Account locked for 15 minutes' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserProfile; mustChangePassword: boolean }> {
    const { user, tokens, mustChangePassword } = await this.auth.login(dto);
    this.cookies.set(res, tokens);
    return { user, mustChangePassword };
  }

  @Public()
  @HttpCode(204)
  @Post('refresh')
  @ApiReq(
    ['ACC-06', 'ACC-19'],
    'Refresh the session',
    'Uses the refresh_token cookie to issue a new access token and a new refresh token (rotation). Reusing an old refresh token revokes the session. Fails once the session has been idle for 30 minutes.',
  )
  @ApiNoContentResponse({ description: 'New cookies are set' })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid or expired session',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const tokens = await this.auth.refresh(readCookie(req, REFRESH_COOKIE));
    this.cookies.set(res, tokens);
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  @ApiReq(
    'ACC-06',
    'Log out',
    'Clears the auth cookies and revokes the session (and its refresh token) on the server. Safe to call when already logged out.',
  )
  @ApiNoContentResponse({ description: 'Logged out' })
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(readCookie(req, REFRESH_COOKIE), req.user);
    this.cookies.clear(res);
  }

  @AllowPasswordChange()
  @Get('me')
  @ApiCookieAuth()
  @ApiReq(
    ['ACC-04', 'ACC-19'],
    'Current user',
    'The frontend gets the logged-in user from here (tokens are never readable by JavaScript).',
  )
  @ApiOkResponse({ description: 'The logged-in user' })
  @ApiUnauthorizedResponse({ description: 'Not logged in or session expired' })
  me(@CurrentUser() user: AuthUser): Promise<UserProfile> {
    return this.auth.me(user);
  }

  @AllowPasswordChange()
  @HttpCode(204)
  @Patch('change-password')
  @ApiCookieAuth()
  @ApiReq(
    ['ACC-08', 'ACC-07a'],
    'Change password',
    'Needs the current password and a new one that follows the password rules. Signs out every other device and keeps this one logged in with fresh cookies. Also the way out of a temporary password.',
  )
  @ApiNoContentResponse({
    description: 'Password changed; new cookies are set',
  })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const tokens = await this.auth.changePassword(user, dto);
    this.cookies.set(res, tokens);
  }

  @Public()
  @Get('verify-email')
  @ApiReq(
    'ACC-02',
    'Verify the email address (optional bonus)',
    'Opens the link from the verification email: send its `token`. Marks the account as verified. The link works once and expires after 24 hours. Registration sends the first link; ask for another with POST /api/auth/resend-verification. Booking is blocked until verification only when the server runs with EMAIL_VERIFICATION_REQUIRED=true (off by default).',
  )
  @ApiOkResponse({
    schema: { example: { message: 'Your email address is verified.' } },
  })
  @ApiBadRequestResponse({
    description: 'The link is invalid, expired or already used',
  })
  async verifyEmail(
    @Query() query: VerifyEmailQueryDto,
  ): Promise<{ message: string }> {
    await this.emailVerification.verify(query.token);
    return { message: 'Your email address is verified.' };
  }

  @HttpCode(200)
  @Post('resend-verification')
  @ApiCookieAuth()
  @ApiReq(
    'ACC-02',
    'Send a new verification link (optional bonus)',
    'For the logged-in user: emails a new verification link, replacing the older one. Nothing is sent when the address is already verified. With no SMTP server configured the email is written to the server log (outside production).',
  )
  @ApiOkResponse({
    schema: {
      example: { message: 'A new verification link has been sent.' },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  async resendVerification(
    @CurrentUser() user: AuthUser,
  ): Promise<{ message: string }> {
    const { alreadyVerified } = await this.emailVerification.resend(user.id);
    return {
      message: alreadyVerified
        ? 'Your email address is already verified.'
        : 'A new verification link has been sent.',
    };
  }

  @Public()
  @HttpCode(200)
  @Post('forgot-password')
  @ApiReq(
    'ACC-07',
    'Ask for a password reset link (optional bonus)',
    `Sends a reset link to the email if it belongs to an active account. The answer is always the same, so it never reveals whether the email is registered. The link works once, for ${RESET_LINK_TTL_MINUTES} minutes, and a newer request replaces an older link. With no SMTP server configured the email is written to the server log (outside production).`,
  )
  @ApiOkResponse({
    schema: {
      example: {
        message:
          'If that email belongs to an account, a reset link has been sent.',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Not a valid email address' })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    await this.passwordReset.request(dto.email);
    return {
      message:
        'If that email belongs to an account, a reset link has been sent.',
    };
  }

  @Public()
  @HttpCode(200)
  @Post('reset-password')
  @ApiReq(
    'ACC-07',
    'Reset the password with the emailed token (optional bonus)',
    'Takes the token from the reset email and a new password that follows the password rules. The link is single-use and expires after 30 minutes. Signs the account out on every device and clears any login lock; log in again afterwards.',
  )
  @ApiOkResponse({
    schema: {
      example: {
        message:
          'Your password has been changed. Log in with the new password.',
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'The link is invalid, expired or already used, or the password breaks the rules',
  })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.passwordReset.reset(dto.token, dto.newPassword);
    return {
      message: 'Your password has been changed. Log in with the new password.',
    };
  }
}

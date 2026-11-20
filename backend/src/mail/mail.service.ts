import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';

/** One email to one person. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const DEFAULT_PORT = 587;
const DEFAULT_FROM = 'Travel Platform <no-reply@travel-platform.local>';

/**
 * GEN-01-B: sends email through SMTP (a test inbox such as Ethereal or
 * Mailtrap in development). Everything comes from the environment:
 * `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`
 * (`true` for TLS from the start) and `MAIL_FROM`.
 *
 * With no `SMTP_HOST` nothing is sent: outside production the message is
 * written to the log so a developer can open the link, and in production only
 * a warning is logged (never the body, which holds live links).
 *
 * A failed send throws; the caller decides what that means.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transport?: Transporter;

  constructor(private readonly config: ConfigService) {}

  /** True when an SMTP server is set, so emails really leave the app. */
  get configured(): boolean {
    return !!this.config.get<string>('SMTP_HOST')?.trim();
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.configured) {
      this.logUnsent(message);
      return;
    }
    await this.getTransport().sendMail({
      from: this.config.get<string>('MAIL_FROM', DEFAULT_FROM),
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  }

  private getTransport(): Transporter {
    if (!this.transport) {
      const user = this.config.get<string>('SMTP_USER');
      const pass = this.config.get<string>('SMTP_PASS');
      this.transport = createTransport({
        host: this.config.get<string>('SMTP_HOST')?.trim(),
        port: Number(
          this.config.get<string>('SMTP_PORT', String(DEFAULT_PORT)),
        ),
        secure: this.config.get<string>('SMTP_SECURE') === 'true',
        ...(user ? { auth: { user, pass } } : {}),
      });
    }
    return this.transport;
  }

  private logUnsent(message: MailMessage): void {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      this.logger.warn(
        `Email "${message.subject}" to ${message.to} was not sent: SMTP_HOST is not set`,
      );
      return;
    }
    this.logger.log(
      `SMTP is not configured; email not sent.\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
    );
  }
}

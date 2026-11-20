import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

/** What the code under test passes to nodemailer's `createTransport` / `sendMail`. */
type Options = Record<string, unknown>;
type LogSpy = jest.SpyInstance<
  void,
  [message: unknown, ...optionalParams: unknown[]]
>;
const createTransportMock = createTransport as unknown as jest.Mock<
  unknown,
  [Options]
>;

const message = {
  to: 'sara@example.com',
  subject: 'Reset your password',
  text: 'Open https://example.test/reset?token=SECRET-LINK',
};

function build(values: Record<string, string | undefined> = {}) {
  const config = {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
  return new MailService(config);
}

describe('MailService (GEN-01-B)', () => {
  let sendMail: jest.Mock<Promise<unknown>, [Options]>;
  let log: LogSpy;
  let warn: LogSpy;

  beforeEach(() => {
    sendMail = jest
      .fn<Promise<unknown>, [Options]>()
      .mockResolvedValue({ messageId: 'x' });
    createTransportMock.mockReset().mockReturnValue({ sendMail });
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('without an SMTP server', () => {
    // Local runs must work with no mail setup: the message goes to the log so a
    // developer can copy the link, and nothing is sent anywhere.
    it('logs the message (with its link) instead of sending it', async () => {
      await build().send(message);
      expect(createTransportMock).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('sara@example.com'),
      );
      expect(log).toHaveBeenCalledWith(expect.stringContaining('SECRET-LINK'));
    });

    // In production the log must never carry a live reset or verification link.
    it('never writes the message body to the log in production', async () => {
      await build({ NODE_ENV: 'production' }).send(message);
      const logged = [...log.mock.calls, ...warn.mock.calls]
        .map(([line]) => String(line))
        .join('\n');
      expect(logged).not.toContain('SECRET-LINK');
      expect(warn).toHaveBeenCalled();
      expect(createTransportMock).not.toHaveBeenCalled();
    });

    it('reports itself as not configured', () => {
      expect(build().configured).toBe(false);
      expect(build({ SMTP_HOST: '  ' }).configured).toBe(false);
    });
  });

  describe('with an SMTP server', () => {
    const smtp = {
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '2525',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      MAIL_FROM: 'Travel <hello@example.test>',
    };

    it('sends through SMTP with the configured sender', async () => {
      await build(smtp).send({ ...message, html: '<p>hi</p>' });
      expect(createTransportMock).toHaveBeenCalledWith({
        host: 'smtp.example.test',
        port: 2525,
        secure: false,
        auth: { user: 'user', pass: 'pass' },
      });
      expect(sendMail).toHaveBeenCalledWith({
        from: 'Travel <hello@example.test>',
        to: 'sara@example.com',
        subject: 'Reset your password',
        text: message.text,
        html: '<p>hi</p>',
      });
      expect(log).not.toHaveBeenCalledWith(
        expect.stringContaining('SECRET-LINK'),
      );
    });

    it('defaults to port 587, an app sender and no auth when none is set', async () => {
      await build({ SMTP_HOST: 'localhost' }).send(message);
      const options = createTransportMock.mock.calls[0][0];
      expect(options.port).toBe(587);
      expect(options).not.toHaveProperty('auth');
      expect(String(sendMail.mock.calls[0][0].from)).toContain('no-reply@');
    });

    it('uses TLS from the start when SMTP_SECURE is true', async () => {
      await build({ ...smtp, SMTP_SECURE: 'true' }).send(message);
      expect(createTransportMock.mock.calls[0][0].secure).toBe(true);
    });

    // One connection pool for the app, not one per email.
    it('creates the transport once and reuses it', async () => {
      const mail = build(smtp);
      await mail.send(message);
      await mail.send(message);
      expect(createTransportMock).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledTimes(2);
    });

    // The caller decides what a failed email means (e.g. forgot-password hides it).
    it('lets an SMTP failure reach the caller', async () => {
      sendMail.mockRejectedValueOnce(new Error('connection refused'));
      await expect(build(smtp).send(message)).rejects.toThrow(
        'connection refused',
      );
    });

    it('reports itself as configured', () => {
      expect(build(smtp).configured).toBe(true);
    });
  });
});

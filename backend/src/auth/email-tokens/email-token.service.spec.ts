import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { EmailToken, EmailTokenPurpose } from './email-token.schema';
import { EmailTokenService, hashToken } from './email-token.service';

const USER = new Types.ObjectId();
const NOW = new Date('2026-12-01T10:00:00.000Z');
const THIRTY_MINUTES = 30 * 60 * 1000;

function build() {
  const model = {
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
    findOneAndDelete: jest.fn().mockResolvedValue(null),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  };
  const service = new EmailTokenService(model as unknown as Model<EmailToken>);
  return { service, model };
}

describe('hashToken', () => {
  it('is the SHA-256 hex of the token, so the database never holds the token', () => {
    expect(hashToken('abc')).toBe(
      createHash('sha256').update('abc').digest('hex'),
    );
  });
});

describe('EmailTokenService.issue (ACC-02, ACC-07)', () => {
  it('returns a random token and stores only its hash and expiry', async () => {
    const { service, model } = build();
    const token = await service.issue(
      USER.toString(),
      EmailTokenPurpose.PASSWORD_RESET,
      THIRTY_MINUTES,
      NOW,
    );

    // 32 random bytes as base64url is 43 characters.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [filter, update, options] = model.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      { $set: { tokenHash: string; expiresAt: Date } },
      Record<string, unknown>,
    ];
    expect(filter).toEqual({
      user: USER,
      purpose: EmailTokenPurpose.PASSWORD_RESET,
    });
    expect(update.$set.tokenHash).toBe(hashToken(token));
    expect(update.$set.tokenHash).not.toContain(token);
    expect(update.$set.expiresAt).toEqual(
      new Date(NOW.getTime() + THIRTY_MINUTES),
    );
    expect(options).toMatchObject({ upsert: true });
  });

  // One live token per user and purpose: a newer request overwrites the older
  // one in a single atomic write, so the older link stops working.
  it('replaces the previous token of the same user and purpose', async () => {
    const { service, model } = build();
    const first = await service.issue(
      USER.toString(),
      EmailTokenPurpose.PASSWORD_RESET,
      THIRTY_MINUTES,
      NOW,
    );
    const second = await service.issue(
      USER.toString(),
      EmailTokenPurpose.PASSWORD_RESET,
      THIRTY_MINUTES,
      NOW,
    );
    expect(first).not.toBe(second);
    const filters = model.findOneAndUpdate.mock.calls.map(
      (call) => (call as [Record<string, unknown>])[0],
    );
    expect(filters[0]).toEqual(filters[1]); // the same document is overwritten
  });

  it('keeps different purposes apart', async () => {
    const { service, model } = build();
    await service.issue(
      USER.toString(),
      EmailTokenPurpose.EMAIL_VERIFICATION,
      THIRTY_MINUTES,
      NOW,
    );
    const [filter] = model.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(filter.purpose).toBe(EmailTokenPurpose.EMAIL_VERIFICATION);
  });
});

describe('EmailTokenService.consume (ACC-02, ACC-07)', () => {
  it('looks the token up by hash, purpose and expiry and returns its user', async () => {
    const { service, model } = build();
    model.findOneAndDelete.mockResolvedValueOnce({ user: USER });
    const userId = await service.consume(
      'raw-token',
      EmailTokenPurpose.PASSWORD_RESET,
      NOW,
    );
    expect(userId).toBe(USER.toString());
    expect(model.findOneAndDelete).toHaveBeenCalledWith({
      tokenHash: hashToken('raw-token'),
      purpose: EmailTokenPurpose.PASSWORD_RESET,
      expiresAt: { $gt: NOW },
    });
  });

  // Deleting while reading is what makes a link single-use, even when two
  // requests arrive at the same moment: only one of them gets the document.
  it('is single-use: the token is removed as it is read', async () => {
    const { service, model } = build();
    model.findOneAndDelete
      .mockResolvedValueOnce({ user: USER })
      .mockResolvedValueOnce(null);
    expect(
      await service.consume('t', EmailTokenPurpose.PASSWORD_RESET, NOW),
    ).toBe(USER.toString());
    expect(
      await service.consume('t', EmailTokenPurpose.PASSWORD_RESET, NOW),
    ).toBeNull();
  });

  it('answers null for an unknown, expired or wrong-purpose token', async () => {
    const { service } = build();
    expect(
      await service.consume('nope', EmailTokenPurpose.PASSWORD_RESET, NOW),
    ).toBeNull();
  });

  it('answers null for an empty or oversized token without asking the database', async () => {
    const { service, model } = build();
    expect(
      await service.consume('', EmailTokenPurpose.PASSWORD_RESET, NOW),
    ).toBeNull();
    expect(
      await service.consume(
        'x'.repeat(500),
        EmailTokenPurpose.PASSWORD_RESET,
        NOW,
      ),
    ).toBeNull();
    expect(model.findOneAndDelete).not.toHaveBeenCalled();
  });
});

describe('EmailTokenService.invalidate', () => {
  it('removes the live token of a user and purpose', async () => {
    const { service, model } = build();
    await service.invalidate(USER.toString(), EmailTokenPurpose.PASSWORD_RESET);
    expect(model.deleteMany).toHaveBeenCalledWith({
      user: USER,
      purpose: EmailTokenPurpose.PASSWORD_RESET,
    });
  });
});

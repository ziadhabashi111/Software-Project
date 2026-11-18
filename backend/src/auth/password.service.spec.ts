import { PASSWORD_REGEX, PasswordService } from './password.service';

describe('PasswordService (GEN-13)', () => {
  const passwords = new PasswordService();

  it('stores a salted hash, never the plain password', async () => {
    const first = await passwords.hash('Passw0rdOk');
    const second = await passwords.hash('Passw0rdOk');
    expect(first).not.toContain('Passw0rdOk');
    expect(first).not.toBe(second);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await passwords.hash('Passw0rdOk');
    expect(await passwords.compare('Passw0rdOk', hash)).toBe(true);
    expect(await passwords.compare('Passw0rdNo', hash)).toBe(false);
  });
});

describe('PASSWORD_REGEX (ACC-01)', () => {
  it.each(['abcdefg1', 'Passw0rdOk', '1abcdefgh', 'a1a1a1a1a1'])(
    'accepts %p',
    (value) => {
      expect(PASSWORD_REGEX.test(value)).toBe(true);
    },
  );

  it.each(['abcdefgh', '12345678', 'short1', '', 'abc 1'])(
    'rejects %p',
    (value) => {
      expect(PASSWORD_REGEX.test(value)).toBe(false);
    },
  );
});

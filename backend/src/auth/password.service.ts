import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';

/** ACC-01: at least 8 characters with at least one letter and one digit. */
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
export const PASSWORD_RULE_MESSAGE =
  'Password must be at least 8 characters and include a letter and a digit';

const SALT_ROUNDS = 10;

/** Passwords are stored only as salted hashes (GEN-13). */
@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return hash(password, SALT_ROUNDS);
  }

  compare(password: string, passwordHash: string): Promise<boolean> {
    return compare(password, passwordHash);
  }
}

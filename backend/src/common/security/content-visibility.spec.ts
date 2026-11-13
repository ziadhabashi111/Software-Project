import { NotFoundException } from '@nestjs/common';
import { Role } from '../../auth/auth.types';
import { assertContentVisible, canViewContent } from './content-visibility';

const author = { id: 'author-1', role: Role.USER };
const stranger = { id: 'someone-else', role: Role.USER };
const admin = { id: 'admin-1', role: Role.ADMIN };

describe('content visibility (GEN-10)', () => {
  it('shows content that is not hidden to everyone, even guests', () => {
    expect(canViewContent({ isHidden: false, authorId: 'author-1' })).toBe(
      true,
    );
    expect(
      canViewContent({ isHidden: false, authorId: 'author-1' }, stranger),
    ).toBe(true);
  });

  it('treats content without an isHidden flag as visible', () => {
    expect(canViewContent({ authorId: 'author-1' })).toBe(true);
  });

  it('shows hidden content to its author', () => {
    expect(
      canViewContent({ isHidden: true, authorId: 'author-1' }, author),
    ).toBe(true);
  });

  it('shows hidden content to administrators', () => {
    expect(
      canViewContent({ isHidden: true, authorId: 'author-1' }, admin),
    ).toBe(true);
  });

  it('hides hidden content from other users, moderators and guests', () => {
    const hidden = { isHidden: true, authorId: 'author-1' };
    expect(canViewContent(hidden, stranger)).toBe(false);
    expect(
      canViewContent(hidden, { id: 'mod', role: Role.HOTEL_MODERATOR }),
    ).toBe(false);
    expect(canViewContent(hidden)).toBe(false);
  });

  it('compares ObjectId-like author ids as strings', () => {
    const objectId = { toString: () => 'author-1' };
    expect(canViewContent({ isHidden: true, authorId: objectId }, author)).toBe(
      true,
    );
  });

  it('assertContentVisible answers 404 so hidden content is not revealed', () => {
    expect(() =>
      assertContentVisible({ isHidden: true, authorId: 'author-1' }, stranger),
    ).toThrow(NotFoundException);
    expect(() =>
      assertContentVisible({ isHidden: true, authorId: 'author-1' }, author),
    ).not.toThrow();
  });
});

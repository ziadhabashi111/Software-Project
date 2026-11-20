import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationQueryDto, skipFor, toPage } from './pagination';

describe('PaginationQueryDto (GEN-05)', () => {
  it('defaults to page 1 with 10 items per page', async () => {
    const dto = plainToInstance(PaginationQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
  });

  it('converts numeric query strings', async () => {
    const dto = plainToInstance(PaginationQueryDto, { page: '3', limit: '5' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(5);
  });

  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: 'abc' },
    { limit: '0' },
    { limit: '11' },
    { limit: '100' },
  ])('rejects %p', async (query) => {
    const dto = plainToInstance(PaginationQueryDto, query);
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});

describe('skipFor', () => {
  it('skips the items of the previous pages', () => {
    expect(skipFor({ page: 1, limit: 10 })).toBe(0);
    expect(skipFor({ page: 3, limit: 10 })).toBe(20);
    expect(skipFor({ page: 2, limit: 25 })).toBe(25);
  });
});

describe('toPage', () => {
  it('wraps items in the common paginated response', () => {
    expect(toPage(['a', 'b'], 12, { page: 2, limit: 10 })).toEqual({
      items: ['a', 'b'],
      total: 12,
      page: 2,
      limit: 10,
    });
  });
});

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 10;
/** GEN-05 fixes the page size at 10, so a client may ask for fewer, never more. */
export const MAX_PAGE_SIZE = DEFAULT_PAGE_SIZE;

/** Query parameters for every paginated list (GEN-05: page size 10). */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit = DEFAULT_PAGE_SIZE;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** Number of documents to skip for the requested page. */
export function skipFor(query: { page: number; limit: number }): number {
  return (query.page - 1) * query.limit;
}

/** The one response shape every list endpoint returns. */
export function toPage<T>(
  items: T[],
  total: number,
  query: { page: number; limit: number },
): Paginated<T> {
  return { items, total, page: query.page, limit: query.limit };
}

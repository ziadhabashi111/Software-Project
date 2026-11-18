import { ApiOperation } from '@nestjs/swagger';

/**
 * Swagger summary with the requirement ID(s), e.g.
 * `@ApiReq('FLT-22', 'Hold seats')` shows "[FLT-22] Hold seats".
 */
export function ApiReq(
  ids: string | string[],
  summary: string,
  description?: string,
): MethodDecorator {
  const list = Array.isArray(ids) ? ids.join(', ') : ids;
  return ApiOperation({
    summary: `[${list}] ${summary}`,
    ...(description ? { description } : {}),
  });
}

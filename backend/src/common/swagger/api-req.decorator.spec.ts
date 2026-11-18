/* Swagger stores its metadata on the prototype methods, so read them directly. */
/* eslint-disable @typescript-eslint/unbound-method */
import { ApiReq } from './api-req.decorator';

// Metadata key @nestjs/swagger uses for ApiOperation ("swagger" + "/apiOperation").
const API_OPERATION = 'swagger/apiOperation';

class Probe {
  @ApiReq('FLT-22', 'Hold seats')
  single(): void {}

  @ApiReq(['FLT-19', 'FLT-21'], 'Create booking', 'Validates passengers.')
  several(): void {}
}

function operationOf(method: keyof Probe): {
  summary?: string;
  description?: string;
} {
  return Reflect.getMetadata(API_OPERATION, Probe.prototype[method]) as {
    summary?: string;
    description?: string;
  };
}

describe('ApiReq', () => {
  it('prefixes the summary with the requirement ID', () => {
    expect(operationOf('single').summary).toBe('[FLT-22] Hold seats');
  });

  it('lists several requirement IDs and keeps the description', () => {
    const op = operationOf('several');
    expect(op.summary).toBe('[FLT-19, FLT-21] Create booking');
    expect(op.description).toBe('Validates passengers.');
  });
});

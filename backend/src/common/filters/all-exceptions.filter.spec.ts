import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function hostWith(json: jest.Mock): ArgumentsHost {
  const response = { status: jest.fn().mockReturnValue({ json }) };
  const request = { url: '/api/x', method: 'GET' };
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('keeps HttpException status and message in the common shape', () => {
    const json = jest.fn();
    filter.catch(new NotFoundException('Flight not found'), hostWith(json));
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        error: 'Not Found',
        message: 'Flight not found',
        path: '/api/x',
      }),
    );
  });

  it('keeps validation message arrays', () => {
    const json = jest.fn();
    filter.catch(
      new BadRequestException(['email must be an email']),
      hostWith(json),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: ['email must be an email'],
      }),
    );
  });

  it('passes field-level validation errors through (GEN-02)', () => {
    const json = jest.fn();
    const errors = [{ field: 'email', messages: ['email must be an email'] }];
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        errors,
      }),
      hostWith(json),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'Validation failed',
        errors,
      }),
    );
  });

  it('maps Mongo duplicate key errors to 409', () => {
    const json = jest.fn();
    filter.catch({ code: 11000 }, hostWith(json));
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 }),
    );
  });

  it('hides internals of unexpected errors', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const json = jest.fn();
    filter.catch(new Error('db password is hunter2'), hostWith(json));
    const [first] = json.mock.calls as unknown[][];
    const body = first[0] as { statusCode: number; message: string };
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Something went wrong');
  });
});

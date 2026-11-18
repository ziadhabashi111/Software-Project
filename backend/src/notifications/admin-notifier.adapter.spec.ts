import { Logger } from '@nestjs/common';
import { AdminNotifierAdapter } from './admin-notifier.adapter';
import type { NotificationService } from './notification.service.interface';

function setup() {
  const notify = jest.fn<Promise<void>, [string, string, string]>(() =>
    Promise.resolve(),
  );
  const service: NotificationService = { notify };
  return { notify, adapter: new AdminNotifierAdapter(service) };
}

const deactivated = {
  type: 'PROVIDER_DEACTIVATED',
  message: 'The hotel "Nile View" was deactivated by an administrator.',
};

describe('AdminNotifierAdapter (ACC-15, GEN-01)', () => {
  it('sends the type and message to every affected user once', async () => {
    const { notify, adapter } = setup();

    await adapter.notify(['u1', 'u2', 'u1'], deactivated);

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(
      'u1',
      deactivated.type,
      deactivated.message,
    );
    expect(notify).toHaveBeenCalledWith(
      'u2',
      deactivated.type,
      deactivated.message,
    );
  });

  it('does nothing for an empty recipient list', async () => {
    const { notify, adapter } = setup();
    await adapter.notify([], deactivated);
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps notifying the others when one recipient fails, and logs it', async () => {
    const { notify, adapter } = setup();
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    notify.mockRejectedValueOnce(new Error('db down'));

    await expect(
      adapter.notify(['u1', 'u2', 'u3'], deactivated),
    ).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledWith(
      'Could not deliver PROVIDER_DEACTIVATED to 1 of 3 users',
    );
    error.mockRestore();
  });
});

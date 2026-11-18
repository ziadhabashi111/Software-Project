import { DeactivationBlockers } from './deactivation-blockers';

describe('DeactivationBlockers (ACC-12)', () => {
  it('has no upcoming bookings when nothing is registered', async () => {
    const blockers = new DeactivationBlockers();
    await expect(blockers.hasUpcomingBookings('user-1')).resolves.toBe(false);
  });

  it('reports upcoming bookings when any registered module finds one', async () => {
    const blockers = new DeactivationBlockers();
    blockers.register({
      hasUpcomingConfirmedBookings: () => Promise.resolve(false),
    });
    blockers.register({
      hasUpcomingConfirmedBookings: (userId) =>
        Promise.resolve(userId === 'user-1'),
    });
    await expect(blockers.hasUpcomingBookings('user-1')).resolves.toBe(true);
    await expect(blockers.hasUpcomingBookings('user-2')).resolves.toBe(false);
  });

  it('asks every module about the right user', async () => {
    const blockers = new DeactivationBlockers();
    const asked: string[] = [];
    blockers.register({
      hasUpcomingConfirmedBookings: (userId) => {
        asked.push(userId);
        return Promise.resolve(false);
      },
    });
    await blockers.hasUpcomingBookings('user-9');
    expect(asked).toEqual(['user-9']);
  });
});

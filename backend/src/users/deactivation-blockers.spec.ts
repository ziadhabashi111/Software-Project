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

  it('ends the unpaid holds in every module that can, skipping the others (ACC-12)', async () => {
    const blockers = new DeactivationBlockers();
    const ended: string[] = [];
    blockers.register({
      hasUpcomingConfirmedBookings: () => Promise.resolve(false),
      endPendingHolds: (userId) => {
        ended.push(`flights:${userId}`);
        return Promise.resolve();
      },
    });
    blockers.register({
      hasUpcomingConfirmedBookings: () => Promise.resolve(false),
    });
    await blockers.endPendingHolds('user-3');
    expect(ended).toEqual(['flights:user-3']);
  });
});

import type { Model } from 'mongoose';
import { AuditAction } from './audit-action';
import { AuditLogService } from './audit-log.service';
import type { AuditLogDocument } from './audit-log.schema';

const ADMIN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const USER_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';

function serviceWithRecorder() {
  const saved: Record<string, unknown>[] = [];
  const model = {
    create: (doc: Record<string, unknown>) => {
      saved.push(doc);
      return Promise.resolve(doc);
    },
  } as unknown as Model<AuditLogDocument>;
  return { service: new AuditLogService(model), saved };
}

describe('AuditLogService (GEN-07)', () => {
  it('records who did what to which target', async () => {
    const { service, saved } = serviceWithRecorder();

    await service.log({
      actorId: ADMIN_ID,
      action: AuditAction.ACCOUNT_SUSPENDED,
      targetType: 'user',
      targetId: USER_ID,
      details: { reason: 'abusive content' },
    });

    expect(saved).toHaveLength(1);
    const [doc] = saved;
    expect(String(doc.actor)).toBe(ADMIN_ID);
    expect(doc.action).toBe('ACCOUNT_SUSPENDED');
    expect(doc.targetType).toBe('user');
    expect(String(doc.targetId)).toBe(USER_ID);
    expect(doc.details).toEqual({ reason: 'abusive content' });
  });

  it('works without a target id or details', async () => {
    const { service, saved } = serviceWithRecorder();
    await service.log({
      actorId: ADMIN_ID,
      action: AuditAction.PASSWORD_RESET,
      targetType: 'user',
    });
    expect(saved[0]).not.toHaveProperty('targetId');
    expect(saved[0]).not.toHaveProperty('details');
    expect(saved[0].action).toBe('PASSWORD_RESET');
  });

  it('covers every admin action the requirements name', () => {
    expect(Object.values(AuditAction)).toEqual(
      expect.arrayContaining([
        'ACCOUNT_SUSPENDED',
        'ACCOUNT_REACTIVATED',
        'PROVIDER_DEACTIVATED',
        'PROVIDER_REACTIVATED',
        'PASSWORD_RESET',
        'CONTENT_HIDDEN',
        'CONTENT_DELETED',
        'REPORT_RESOLVED',
      ]),
    );
  });
});

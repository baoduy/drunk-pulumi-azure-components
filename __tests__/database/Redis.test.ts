import { withStack, restoreStack } from '../testUtils/pulumiMocks';

// DRK-1819 (PULUMI-SEC-005): every Redis AccessPolicyAssignment must grant access to the identity's
// principal object ID, never its client (application) ID, so Entra token access works with
// `disableAccessKeyAuthentication: true`.

const ACCESS_POLICY_ASSIGNMENT = 'azure-native:redis:AccessPolicyAssignment';

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  sku: { name: 'Standard', family: 'C', capacity: 1 },
  disableAccessKeyAuthentication: true,
};

const defaultUAssignedId = {
  id: 'uid-default-id',
  clientId: 'CLIENT-DEFAULT',
  principalId: 'PRINCIPAL-DEFAULT',
  resourceName: 'uid-default',
  resourceGroupName: 'rg',
};

// Typed `as any`: `principalId` is the new item field (the base SHA only knows `clientId`).
const appIdentity = { name: 'app', accessPolicy: 'Data Reader', principalId: 'PRINCIPAL-APP' };

async function deployRedis(name: string, props: any) {
  const { pulumi, Redis, captured } = withStack('dev', (p) => {
    const mod: typeof import('../../src/database/Redis') = require('../../src/database/Redis');
    return { pulumi: p, Redis: mod.Redis };
  });

  let redis;
  try {
    redis = new Redis(name, { ...baseArgs, ...props } as any);
  } catch (err) {
    // A constructor that throws half-way leaves child registrations in flight; let them settle
    // here so their errors land on this test, not the next one.
    await new Promise((resolve) => setTimeout(resolve, 100));
    throw err;
  }
  await pulumi.output(redis.id).promise();
  await new Promise((resolve) => setImmediate(resolve));

  return captured.filter((c) => c.type === ACCESS_POLICY_ASSIGNMENT);
}

describe('Redis — access policy assignments grant the principal object ID', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('S1 — default identity gets one Data Contributor assignment for its principal ID', async () => {
    const assignments = await deployRedis('cache-s1', { defaultUAssignedId });

    expect(assignments).toHaveLength(1);
    expect(assignments[0].inputs.accessPolicyName).toBe('Data Contributor');
    expect(assignments[0].inputs.objectId).toBe('PRINCIPAL-DEFAULT');
    expect(assignments[0].inputs.objectIdAlias).toBe('uid-default');
  });

  test('S2 — additional identity gets an assignment with its access policy for its principal ID', async () => {
    const assignments = await deployRedis('cache-s2', { additionalUserAssignedIds: [appIdentity] });

    expect(assignments).toHaveLength(1);
    expect(assignments[0].inputs.accessPolicyName).toBe('Data Reader');
    expect(assignments[0].inputs.objectId).toBe('PRINCIPAL-APP');
    expect(assignments[0].inputs.objectIdAlias).toBe('app');
  });

  test('S3 — no assignment uses the client ID as its object ID or alias', async () => {
    const assignments = await deployRedis('cache-s3', { defaultUAssignedId, additionalUserAssignedIds: [appIdentity] });

    expect(assignments).toHaveLength(2);
    for (const a of assignments) {
      expect(a.inputs.objectId).not.toBe('CLIENT-DEFAULT');
      expect(a.inputs.objectIdAlias).not.toBe('CLIENT-DEFAULT');
    }
  });

  test('S4 — no identities means no access policy assignment', async () => {
    const assignments = await deployRedis('cache-s4', {});

    expect(assignments).toHaveLength(0);
  });
});

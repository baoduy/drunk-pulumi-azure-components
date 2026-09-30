import { Captured, restoreStack, withStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1821 rows 1 and 2 (PULUMI-ARGS-001): a value the caller sets on `FirewallArgs` reaches the
 * deployed FirewallPolicy / AzureFirewall instead of only choosing between hard-coded defaults.
 * Every expected value below is a literal from the spec (DRK-1821 / DRK-1855 §6-§7).
 */

const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
const POLICY = 'azure-native:network:FirewallPolicy';
const FIREWALL = 'azure-native:network:AzureFirewall';

const STANDARD = { name: 'AZFW_VNet', tier: 'Standard' } as const;
const BASIC = { name: 'AZFW_VNet', tier: 'Basic' } as const;

type Deployed = { policy: any; firewall: any };

// One mock monitor for the whole file: a component from an earlier test still registers its
// outputs asynchronously, and a monitor swapped in by a later `withStack` would reject its URN.
const { Firewall, captured } = withStack(
  'dev',
  () => {
    const mod: typeof import('../../src/vnet/Firewall') = require('../../src/vnet/Firewall');
    return { Firewall: mod.Firewall };
  },
  // `privateIpAddress` reads `ipConfigurations[0]` from the deployed firewall.
  ({ type }) => (type === FIREWALL ? { ipConfigurations: [{ privateIPAddress: '10.0.1.4' }] } : {}),
);

let deployments = 0;

/** Deploys a Firewall with the given args and returns the inputs the component sent for its two resources. */
async function deploy(args: Record<string, unknown>): Promise<Deployed> {
  const name = `hub-fw-${++deployments}`;
  const fw = new Firewall(name, { rsGroup: { resourceGroupName: 'rg', location: 'eastus' }, ...args } as any);
  await new Promise((resolve) => fw.firewall.id.apply(resolve));
  await new Promise((resolve) => fw.policy.id.apply(resolve));

  const find = (type: string) => (captured as Captured[]).find((c) => c.type === type && c.name === name)!.inputs;
  return { policy: find(POLICY), firewall: find(FIREWALL) };
}

describe('Firewall — caller-supplied Args reach the deployed resources (DRK-1821)', () => {
  afterAll(() => restoreStack(ORIGINAL_STACK));

  describe('S1 — caller policy.dnsSettings is applied verbatim (R1)', () => {
    test('Standard tier: policy dnsSettings equals the caller value', async () => {
      const { policy } = await deploy({
        sku: STANDARD,
        policy: { dnsSettings: { servers: ['10.0.0.4'], enableProxy: false } },
      });

      expect(policy.dnsSettings).toEqual({ servers: ['10.0.0.4'], enableProxy: false });
    });

    test('Basic tier: policy dnsSettings equals the caller value', async () => {
      const { policy } = await deploy({
        sku: BASIC,
        policy: { dnsSettings: { servers: ['10.0.0.4'], enableProxy: false } },
      });

      expect(policy.dnsSettings).toEqual({ servers: ['10.0.0.4'], enableProxy: false });
    });
  });

  describe('S2 — caller policy.threatIntelMode is applied verbatim (R1)', () => {
    test("Standard tier: policy threatIntelMode is 'Alert'", async () => {
      const { policy } = await deploy({ sku: STANDARD, policy: { threatIntelMode: 'Alert' } });

      expect(policy.threatIntelMode).toBe('Alert');
    });

    test("Basic tier: policy threatIntelMode is 'Alert'", async () => {
      const { policy } = await deploy({ sku: BASIC, policy: { threatIntelMode: 'Alert' } });

      expect(policy.threatIntelMode).toBe('Alert');
    });
  });

  describe('S3 — nothing set keeps the tier defaults (R2)', () => {
    test("Standard tier: dnsSettings { enableProxy: true } and threatIntelMode 'Deny'", async () => {
      const { policy } = await deploy({ sku: STANDARD, policy: {} });

      expect(policy.dnsSettings).toEqual({ enableProxy: true });
      expect(policy.threatIntelMode).toBe('Deny');
    });

    test('Basic tier: dnsSettings and threatIntelMode are both undefined', async () => {
      const { policy } = await deploy({ sku: BASIC, policy: {} });

      expect(policy.dnsSettings).toBeUndefined();
      expect(policy.threatIntelMode).toBeUndefined();
    });
  });

  describe('S4 — caller firewall threatIntelMode is applied, default kept when unset (R1, R2)', () => {
    test("threatIntelMode 'Alert' on the firewall: AzureFirewall threatIntelMode is 'Alert'", async () => {
      const { firewall } = await deploy({ sku: STANDARD, policy: {}, threatIntelMode: 'Alert' });

      expect(firewall.threatIntelMode).toBe('Alert');
    });

    test("unset on Standard tier: AzureFirewall threatIntelMode is 'Deny'", async () => {
      const { firewall } = await deploy({ sku: STANDARD, policy: {} });

      expect(firewall.threatIntelMode).toBe('Deny');
    });
  });

  describe('S5 — caller policy.basePolicy becomes the parent policy (R3)', () => {
    test('basePolicy set: policy basePolicy.id equals the caller id', async () => {
      const { policy } = await deploy({
        sku: STANDARD,
        policy: {
          basePolicy: { id: '/sub/x/firewallPolicies/base', resourceName: 'base', resourceGroupName: 'rg-hub' },
        },
      });

      expect(policy.basePolicy).toEqual({ id: '/sub/x/firewallPolicies/base' });
    });

    test('basePolicy unset: policy basePolicy is undefined', async () => {
      const { policy } = await deploy({ sku: STANDARD, policy: {} });

      expect(policy.basePolicy).toBeUndefined();
    });
  });
});

import { withStack, restoreStack, Captured } from '../testUtils/pulumiMocks';

// DRK-1820 Build additions (not part of the frozen AT set): tier lists, capacity boundary,
// caller-wins on the PRD defaults, and Output-typed sku / siteConfig (brief §9 Q3).

const WEB_APP = 'azure-native:web:WebApp';
const PLAN = 'azure-native:web:AppServicePlan';

async function build(stack: 'prd' | 'dev', props: any): Promise<Captured[]> {
  const { pulumi, AppService, captured } = withStack(stack, (p) => {
    const mod: typeof import('../../src/app/AppService') = require('../../src/app/AppService');
    return { pulumi: p, AppService: mod.AppService };
  });
  const resolve = (value: any) => (typeof value === 'function' ? value(pulumi) : value);
  const svc = new AppService('svc', {
    rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
    ...props,
    sku: resolve(props.sku),
    webApps: props.webApps ?? [{ name: 'web', siteConfig: resolve(props.siteConfig) }],
  } as any);
  await pulumi.output(svc.id).promise();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return captured;
}

const inputsOf = (captured: Captured[], type: string) => captured.find((c) => c.type === type)!.inputs;

describe('AppService — PRD alwaysOn default per plan tier', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test.each([
    ['Basic', true],
    ['Standard', true],
    ['Premium', true],
    ['PremiumV2', true],
    ['PremiumV3', true],
    ['PremiumMV3', true],
    ['PremiumV4', true],
    ['Isolated', true],
    ['IsolatedV2', true],
    ['Free', false],
    ['Shared', false],
    ['ElasticPremium', false],
  ])('prd + %s: alwaysOn defaults to %s', async (tier, expected) => {
    const captured = await build('prd', { sku: { name: 'X1', tier } });

    expect(inputsOf(captured, WEB_APP).siteConfig.alwaysOn).toBe(expected);
  });

  test('prd + PremiumV3 with caller alwaysOn false: stays false', async () => {
    const captured = await build('prd', { sku: { name: 'P1v3', tier: 'PremiumV3' }, siteConfig: { alwaysOn: false } });

    expect(inputsOf(captured, WEB_APP).siteConfig.alwaysOn).toBe(false);
  });

  test('dev + Free with caller alwaysOn true: stays true', async () => {
    const captured = await build('dev', { sku: { name: 'F1', tier: 'Free' }, siteConfig: { alwaysOn: true } });

    expect(inputsOf(captured, WEB_APP).siteConfig.alwaysOn).toBe(true);
  });
});

describe('AppService — PRD zoneRedundant default per plan tier and capacity', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test.each([
    ['PremiumV2', 2, true],
    ['PremiumV3', 2, true],
    ['PremiumMV3', 2, true],
    ['PremiumV4', 2, true],
    ['ElasticPremium', 2, true],
    ['IsolatedV2', 2, true],
    ['Premium', 3, false],
    ['Standard', 3, false],
    ['Isolated', 3, false],
  ])('prd + %s capacity %s: zoneRedundant defaults to %s', async (tier, capacity, expected) => {
    const captured = await build('prd', { sku: { name: 'X1', tier, capacity } });

    expect(inputsOf(captured, PLAN).zoneRedundant).toBe(expected);
  });

  test('dev + Basic with caller zoneRedundant true: stays true', async () => {
    const captured = await build('dev', { sku: { name: 'B1', tier: 'Basic' }, zoneRedundant: true });

    expect(inputsOf(captured, PLAN).zoneRedundant).toBe(true);
  });
});

describe('AppService — Output-typed inputs', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('prd + sku as an Output: tier is unknown, so alwaysOn and zoneRedundant default to false', async () => {
    const captured = await build('prd', {
      sku: (p: typeof import('@pulumi/pulumi')) => p.output({ name: 'P1v3', tier: 'PremiumV3', capacity: 3 }),
    });

    expect(inputsOf(captured, PLAN).zoneRedundant).toBe(false);
    expect(inputsOf(captured, WEB_APP).siteConfig.alwaysOn).toBe(false);
  });

  test('siteConfig as an Output: defaults are merged in and caller keys win', async () => {
    const captured = await build('dev', {
      sku: { name: 'P1v3', tier: 'PremiumV3' },
      siteConfig: (p: typeof import('@pulumi/pulumi')) =>
        p.output({ minTlsVersion: '1.3', linuxFxVersion: 'NODE|20-lts' }),
    });

    expect(inputsOf(captured, WEB_APP).siteConfig).toMatchObject({
      minTlsVersion: '1.3',
      ftpsState: 'Disabled',
      http20Enabled: true,
      alwaysOn: false,
      linuxFxVersion: 'NODE|20-lts',
    });
  });
});

describe('AppService — no web apps', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('empty webApps: only the plan is created, no web app or publishing resources', async () => {
    const captured = await build('dev', { sku: { name: 'P1v3', tier: 'PremiumV3' }, webApps: [] });

    expect(captured.map((c) => c.type).sort()).toEqual(['azure-native:web:AppServicePlan', 'drunk:azure:AppService']);
  });
});

describe('AppService — plan without sku', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('prd + no sku: alwaysOn and zoneRedundant default to false', async () => {
    const captured = await build('prd', {});

    expect(inputsOf(captured, PLAN).zoneRedundant).toBe(false);
    expect(inputsOf(captured, WEB_APP).siteConfig.alwaysOn).toBe(false);
  });
});

describe('AppService — publishing resources are children of the component', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('each WebAppFtpAllowed / WebAppScmAllowed is parented to the component and depends on its web app', async () => {
    const { pulumi, AppService } = withStack('dev', (p) => {
      const mod: typeof import('../../src/app/AppService') = require('../../src/app/AppService');
      return { pulumi: p, AppService: mod.AppService };
    });
    // Component transformations are inherited only by resources that name the component as parent.
    const seen: { type: string; resource: any; parent?: any; dependsOn?: any }[] = [];
    const svc = new AppService(
      'svc',
      {
        rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
        sku: { name: 'P1v3', tier: 'PremiumV3' },
        webApps: [{ name: 'web' }],
      } as any,
      {
        transformations: [
          (a) => {
            seen.push({ type: a.type, resource: a.resource, parent: a.opts.parent, dependsOn: a.opts.dependsOn });
            return undefined;
          },
        ],
      },
    );
    await pulumi.output(svc.id).promise();

    const webApp = seen.find((s) => s.type === 'azure-native:web:WebApp');
    for (const type of ['azure-native:web:WebAppFtpAllowed', 'azure-native:web:WebAppScmAllowed']) {
      const child = seen.find((s) => s.type === type);
      expect(child?.parent).toBe(svc);
      expect(child?.dependsOn).toHaveLength(1);
      expect(child?.dependsOn[0]).toBe(webApp?.resource);
    }
  });
});

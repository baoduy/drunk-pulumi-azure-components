import { withStack, restoreStack, Captured } from '../testUtils/pulumiMocks';

// DRK-1820 (spec revision 3): AppService fills absent values with secure defaults on every web app
// (HTTPS-only, TLS 1.2, FTP off, HTTP/2, basic-auth publishing off) and, in PRD only, turns on
// `alwaysOn` and plan zone redundancy where the plan SKU supports them. A caller value always wins.

const WEB_APP = 'azure-native:web:WebApp';
const PLAN = 'azure-native:web:AppServicePlan';
const FTP_ALLOWED = 'azure-native:web:WebAppFtpAllowed';
const SCM_ALLOWED = 'azure-native:web:WebAppScmAllowed';

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  sku: { name: 'P1v3', tier: 'PremiumV3' },
};

function load(stack: 'prd' | 'dev') {
  return withStack(stack, (p) => {
    const mod: typeof import('../../src/app/AppService') = require('../../src/app/AppService');
    return { pulumi: p, AppService: mod.AppService };
  });
}

/**
 * Builds the component on the given stack and waits until every resource it registers has reached
 * the mock. The publishing-credential resources take their `name` from the web app's output, so they
 * register a few ticks after the web app itself — settle well past that.
 */
async function build(stack: 'prd' | 'dev', props: any): Promise<Captured[]> {
  const { pulumi, AppService, captured } = load(stack);
  const svc = new AppService('svc', { ...baseArgs, ...props } as any);
  await pulumi.output(svc.id).promise();
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  return captured;
}

const ofType = (captured: Captured[], type: string) => captured.filter((c) => c.type === type);
const webApp = (captured: Captured[]) => ofType(captured, WEB_APP)[0];
const plan = (captured: Captured[]) => ofType(captured, PLAN)[0];

describe('AppService — secure web app defaults', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('S1 — dev, no caller values: web app is HTTPS-only', async () => {
    const captured = await build('dev', { webApps: [{ name: 'web' }] });

    expect(webApp(captured).inputs.httpsOnly).toBe(true);
  });

  test('S2 — dev, no caller siteConfig: TLS 1.2, FTP disabled, HTTP/2 on, alwaysOn off', async () => {
    const captured = await build('dev', { webApps: [{ name: 'web' }] });

    const siteConfig = webApp(captured).inputs.siteConfig;
    expect(siteConfig?.minTlsVersion).toBe('1.2');
    expect(siteConfig?.ftpsState).toBe('Disabled');
    expect(siteConfig?.http20Enabled).toBe(true);
    expect(siteConfig?.alwaysOn).toBe(false);
  });

  test('S3 — caller httpsOnly and siteConfig keys are kept; http20Enabled is still added', async () => {
    const captured = await build('dev', {
      webApps: [
        {
          name: 'web',
          httpsOnly: false,
          siteConfig: { ftpsState: 'FtpsOnly', minTlsVersion: '1.3', linuxFxVersion: 'NODE|20-lts' },
        },
      ],
    });

    const inputs = webApp(captured).inputs;
    expect(inputs.httpsOnly).toBe(false);
    expect(inputs.siteConfig?.ftpsState).toBe('FtpsOnly');
    expect(inputs.siteConfig?.minTlsVersion).toBe('1.3');
    expect(inputs.siteConfig?.linuxFxVersion).toBe('NODE|20-lts');
    expect(inputs.siteConfig?.http20Enabled).toBe(true);
  });

  test('S4 — prd, sku P1v3 / PremiumV3: alwaysOn defaults to true', async () => {
    const captured = await build('prd', { sku: { name: 'P1v3', tier: 'PremiumV3' }, webApps: [{ name: 'web' }] });

    expect(webApp(captured).inputs.siteConfig?.alwaysOn).toBe(true);
  });

  test('S5 — prd, sku Y1 / Dynamic: alwaysOn defaults to false', async () => {
    const captured = await build('prd', { sku: { name: 'Y1', tier: 'Dynamic' }, webApps: [{ name: 'web' }] });

    expect(webApp(captured).inputs.siteConfig?.alwaysOn).toBe(false);
  });
});

describe('AppService — basic-auth publishing lockdown', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('S6 — two web apps: one WebAppFtpAllowed and one WebAppScmAllowed each, all allow false', async () => {
    const captured = await build('dev', { webApps: [{ name: 'web' }, { name: 'api' }] });

    const ftp = ofType(captured, FTP_ALLOWED);
    const scm = ofType(captured, SCM_ALLOWED);
    expect(ftp).toHaveLength(2);
    expect(scm).toHaveLength(2);
    for (const resource of [...ftp, ...scm]) {
      expect(resource.inputs.allow).toBe(false);
      expect(resource.inputs.resourceGroupName).toBe('rg');
    }
    // Each lockdown resource targets the web app the component created (mock name = `svc-<webApp.name>`).
    expect(ftp.map((r) => r.inputs.name).sort()).toEqual(['svc-api', 'svc-web']);
    expect(scm.map((r) => r.inputs.name).sort()).toEqual(['svc-api', 'svc-web']);
  });

  test('S7 — allowBasicPublishing true: that app allows FTP and SCM, and the flag never reaches WebApp', async () => {
    const captured = await build('dev', {
      webApps: [{ name: 'legacy', allowBasicPublishing: true }, { name: 'web' }],
    });

    const forApp = (type: string, appName: string) => ofType(captured, type).filter((r) => r.inputs.name === appName);
    expect(forApp(FTP_ALLOWED, 'svc-legacy')).toHaveLength(1);
    expect(forApp(SCM_ALLOWED, 'svc-legacy')).toHaveLength(1);
    expect(forApp(FTP_ALLOWED, 'svc-legacy')[0].inputs.allow).toBe(true);
    expect(forApp(SCM_ALLOWED, 'svc-legacy')[0].inputs.allow).toBe(true);
    // The other app keeps the lockdown.
    expect(forApp(FTP_ALLOWED, 'svc-web')[0]?.inputs.allow).toBe(false);
    expect(forApp(SCM_ALLOWED, 'svc-web')[0]?.inputs.allow).toBe(false);

    for (const app of ofType(captured, WEB_APP)) {
      expect(app.inputs).not.toHaveProperty('allowBasicPublishing');
    }
  });
});

describe('AppService — plan zone redundancy', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test.each([
    ['prd', 'PremiumV3', 3, true],
    ['prd', 'PremiumV3', undefined, false],
    ['prd', 'PremiumV3', 1, false],
    ['prd', 'Basic', 3, false],
    ['dev', 'PremiumV3', 3, false],
  ] as const)('S8 — %s + %s capacity %s: zoneRedundant defaults to %s', async (stack, tier, capacity, expected) => {
    const name = tier === 'Basic' ? 'B1' : 'P1v3';
    const sku = capacity === undefined ? { name, tier } : { name, tier, capacity };
    const captured = await build(stack, { sku, webApps: [{ name: 'web' }] });

    expect(plan(captured).inputs.zoneRedundant).toBe(expected);
  });

  test('S9 — prd + PremiumV3 capacity 3 with caller zoneRedundant false: stays false', async () => {
    const captured = await build('prd', {
      sku: { name: 'P1v3', tier: 'PremiumV3', capacity: 3 },
      zoneRedundant: false,
      webApps: [{ name: 'web' }],
    });

    expect(plan(captured).inputs.zoneRedundant).toBe(false);
  });
});

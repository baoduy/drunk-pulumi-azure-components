import * as pulumi from '@pulumi/pulumi';

/**
 * DRK-1047 / PULUMI-PKG-002 — AppResources must call `registerOutputs()` as the last
 * constructor statement so the Pulumi engine knows the component's resource tree is
 * complete and its outputs are safe to resolve for downstream consumers.
 *
 * AppResources is a pure orchestration class — it wires ~15 optional sub-resources
 * from typed args. The sub-resources are mocked out (boundary mocking: real Apim,
 * StorageAccount, etc. are exercised by their own test suites) so this file can drive
 * every optional-wiring branch, plus every `createVault()` branch, without needing a
 * valid args shape for each real Azure resource.
 */

pulumi.runtime.setMocks({
  newResource: (args: pulumi.runtime.MockResourceArgs) => ({
    id: `${args.name}_id`,
    state: { ...args.inputs, name: args.name },
  }),
  call: (args: pulumi.runtime.MockCallArgs) => args.inputs,
});

function mockComponent(label: string) {
  return jest.fn().mockImplementation(function (this: any, name: string, args: any) {
    this.name = name;
    this.args = args;
    this.getOutputs = () => ({ label, name, args });
  });
}

jest.mock('../src/storage', () => ({ StorageAccount: mockComponent('storage') }));
jest.mock('../src/services', () => ({
  Automation: mockComponent('automation'),
  AzSearch: mockComponent('azSearch'),
  ServiceBus: mockComponent('serviceBus'),
}));
jest.mock('../src/apim', () => ({ Apim: mockComponent('apim') }));
jest.mock('../src/app', () => ({
  AppCert: mockComponent('appCert'),
  AppConfig: mockComponent('appConfig'),
  AppContainerEnv: mockComponent('appContainerEnv'),
  IoTHub: mockComponent('iotHub'),
  LogicApp: mockComponent('logicApp'),
  SignalR: mockComponent('signalR'),
}));
jest.mock('../src/database', () => ({
  AzSql: mockComponent('azSql'),
  MySql: mockComponent('mySql'),
  Postgres: mockComponent('postgres'),
  Redis: mockComponent('redis'),
}));
jest.mock('../src/vault', () => ({ KeyVault: mockComponent('keyVault') }));

import { AppResources } from '../src/AppResources';

const rsGroup = { resourceGroupName: 'rg' };

// One representative value per optional slot — enough to flip every `field ? new X() : undefined`
// ternary in the constructor to its truthy branch. No `name` on any of them, so every
// `field.name ?? name` fallback also takes its right-hand branch. Shape doesn't matter to real
// Azure semantics since every sub-component constructor is mocked.
const allOptionalArgs = {
  apim: {},
  storageAccount: {},
  serviceBus: {},
  automation: {},
  azSearch: {},
  appCert: {},
  appConfig: {},
  appContainerEnv: {},
  iotHub: {},
  logicApp: {},
  signalR: {},
  azSql: {},
  mySql: {},
  postgres: {},
  redis: {},
};

describe('AppResources — registerOutputs (PULUMI-PKG-002)', () => {
  test('constructor registers outputs once, as the last statement, with every optional sub-resource wired', () => {
    const spy = jest.spyOn(pulumi.ComponentResource.prototype, 'registerOutputs');

    const app = new AppResources('app-full', { rsGroup, vaultCreate: { name: 'vault1' }, ...allOptionalArgs } as any);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.instances[0]).toBe(app);
    expect(spy.mock.calls[0][0]).toEqual(app.getOutputs());

    const outputs = app.getOutputs();
    expect(outputs.apim).toBeDefined();
    expect(outputs.storage).toBeDefined();
    expect(outputs.serviceBus).toBeDefined();
    expect(outputs.automation).toBeDefined();
    expect(outputs.azSearch).toBeDefined();
    expect(outputs.appCert).toBeDefined();
    expect(outputs.appConfig).toBeDefined();
    expect(outputs.appContainerEnv).toBeDefined();
    expect(outputs.iotHub).toBeDefined();
    expect(outputs.logicApp).toBeDefined();
    expect(outputs.signalR).toBeDefined();
    expect(outputs.azSql).toBeDefined();
    expect(outputs.mySql).toBeDefined();
    expect(outputs.postgres).toBeDefined();
    expect(outputs.redis).toBeDefined();
    expect(outputs.vaultInfo).toBeDefined();

    spy.mockRestore();
  });

  test('constructor registers outputs even with no optional sub-resource and no vault requested', () => {
    const spy = jest.spyOn(pulumi.ComponentResource.prototype, 'registerOutputs');

    const app = new AppResources('app-empty', { rsGroup } as any);

    expect(spy).toHaveBeenCalledTimes(1);
    const outputs = app.getOutputs();
    expect(outputs.apim).toBeUndefined();
    expect(outputs.storage).toBeUndefined();
    expect(outputs.vaultInfo).toBeUndefined();

    spy.mockRestore();
  });

  test('createVault reuses a pre-existing vaultInfo instead of creating a new KeyVault', () => {
    const spy = jest.spyOn(pulumi.ComponentResource.prototype, 'registerOutputs');
    const vaultInfo = { resourceName: 'vault1', id: 'vault-id', resourceGroupName: 'rg' };

    const app = new AppResources('app-existing-vault', { rsGroup, vaultInfo } as any);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(app.getOutputs().vaultInfo).toBeDefined();

    spy.mockRestore();
  });
});

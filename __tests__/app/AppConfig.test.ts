import * as pulumi from '@pulumi/pulumi';

type Captured = { type: string; name: string; inputs: any };
const captured: Captured[] = [];

pulumi.runtime.setMocks({
  newResource: (args: pulumi.runtime.MockResourceArgs) => {
    captured.push({ type: args.type, name: args.name, inputs: args.inputs });
    return { id: `${args.name}_id`, state: { ...args.inputs, name: args.name } };
  },
  call: (args: pulumi.runtime.MockCallArgs) =>
    args.token === 'azure-native:appconfiguration:listConfigurationStoreKeys'
      ? { value: [{ value: 'primary-conn' }, { value: 'secondary-conn' }] }
      : args.inputs,
});

// Imported after setMocks so module-level resources register against the mock monitor.
import { AppConfig } from '../../src/app/AppConfig';

const rsGroup = { resourceGroupName: 'rg', location: 'eastus' };
const vaultInfo = { resourceGroupName: 'rg', resourceName: 'kv1', id: 'kv1_id' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

const ofType = (type: string) => captured.filter((c) => c.type === type);
const store = (name: string) =>
  ofType('azure-native:appconfiguration:ConfigurationStore').find((c) => c.name === name)?.inputs;

describe('AppConfig', () => {
  beforeEach(() => {
    captured.length = 0;
  });

  test('with local auth and a vault it stores the primary and secondary connection strings', async () => {
    const ac = new AppConfig('ac-secrets', { rsGroup, vaultInfo } as any);
    await pulumi.output(ac.id).promise();
    await settle();

    expect(ofType('drunk:azure:VaultSecret').map((c) => c.name)).toEqual([
      'ac-secrets-primary-conn',
      'ac-secrets-secondary-conn',
    ]);
  });

  test('with disableLocalAuth it stores no connection strings', async () => {
    const ac = new AppConfig('ac-noauth', { rsGroup, vaultInfo, disableLocalAuth: true } as any);
    await pulumi.output(ac.id).promise();
    await settle();

    expect(ofType('drunk:azure:VaultSecret')).toEqual([]);
  });

  test('with no network it keeps public access enabled and uses the Standard sku', async () => {
    const ac = new AppConfig('ac-open', { rsGroup } as any);
    await pulumi.output(ac.id).promise();

    expect(store('ac-open').publicNetworkAccess).toBe('Enabled');
    expect(store('ac-open').sku).toEqual({ name: 'Standard' });
    expect(store('ac-open').identity).toBeUndefined();
  });

  test('with a resource identity and a user-assigned identity it uses both identity types', async () => {
    const ac = new AppConfig('ac-id', {
      rsGroup,
      enableResourceIdentity: true,
      defaultUAssignedId: { id: 'uid_id', clientId: 'uid_client', principalId: 'uid_principal' },
    } as any);
    await pulumi.output(ac.id).promise();

    expect(store('ac-id').identity).toEqual({
      type: 'SystemAssigned, UserAssigned',
      userAssignedIdentities: ['uid_id'],
    });
  });

  test('with a resource identity only it uses the system-assigned identity', async () => {
    const ac = new AppConfig('ac-sys', { rsGroup, enableResourceIdentity: true } as any);
    await pulumi.output(ac.id).promise();

    expect(store('ac-sys').identity).toEqual({ type: 'SystemAssigned' });
  });
});

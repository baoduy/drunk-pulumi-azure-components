import * as pulumi from '@pulumi/pulumi';
import { withStack, restoreStack, Captured } from '../testUtils/pulumiMocks';

// DRK-770 §5: VM compute-size / OS-image / hardening / zone defaults.
// Default test-runtime stack (no override) resolves to a non-prd stack (see zoneHelper.stack.test.ts),
// so every test in the top-level describe below exercises the non-prd path unless noted.

let captured: Captured[];

pulumi.runtime.setMocks({
  newResource: (args: pulumi.runtime.MockResourceArgs) => {
    captured.push({ type: args.type, name: args.name, inputs: args.inputs });
    return { id: `${args.name}_id`, state: { ...args.inputs, name: args.name } };
  },
  call: (args: pulumi.runtime.MockCallArgs) => args.inputs,
});

import { VirtualMachine } from '../../src/vm/VirtualMachine';

async function createVm(props: any) {
  const vm = new VirtualMachine('vm1', {
    rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
    network: { subnetId: 'subnet_id' },
    ...props,
  });
  await pulumi.output(vm.id).promise();
  return captured.find((c) => c.type === 'azure-native:compute:VirtualMachine')!;
}

describe('VirtualMachine — compute size and OS image defaults', () => {
  beforeEach(() => {
    captured = [];
  });

  test('a Linux machine declared bare gets the standard Arm size and Ubuntu Arm image', async () => {
    const vm = await createVm({});
    expect(vm.inputs.hardwareProfile.vmSize).toBe('Standard_D4ps_v6');
    expect(vm.inputs.storageProfile.imageReference).toEqual({
      publisher: 'canonical',
      offer: 'ubuntu-24_04-lts',
      sku: 'server-arm64',
      version: 'latest',
    });
  });

  // Thin spot called out by the spec-review gate: must not ride on the bare-Arm case.
  test('a Linux machine sized Standard_D4as_v6 with no image resolves the x64 Ubuntu sku', async () => {
    const vm = await createVm({ hardwareProfile: { vmSize: 'Standard_D4as_v6' } });
    expect(vm.inputs.hardwareProfile.vmSize).toBe('Standard_D4as_v6');
    expect(vm.inputs.storageProfile.imageReference.sku).toBe('server');
  });

  test('a Windows machine declared bare gets the standard x64 size and Windows 11 image', async () => {
    const vm = await createVm({ osProfile: { windowsConfiguration: {} } });
    expect(vm.inputs.hardwareProfile.vmSize).toBe('Standard_D4as_v6');
    expect(vm.inputs.storageProfile.imageReference).toEqual({
      publisher: 'microsoftwindowsdesktop',
      offer: 'windows-11',
      sku: 'win11-24h2-pro',
      version: 'latest',
    });
  });

  test('a machine with no operating-system settings at all is treated as Linux', async () => {
    const vm = await createVm({});
    expect(vm.inputs.hardwareProfile.vmSize).toBe('Standard_D4ps_v6');
    expect(vm.inputs.storageProfile.imageReference.offer).toBe('ubuntu-24_04-lts');
  });

  test('an engineer-supplied vmSize passes through verbatim and drives the image sku', async () => {
    const vm = await createVm({ hardwareProfile: { vmSize: 'Standard_D2s_v3' } });
    expect(vm.inputs.hardwareProfile.vmSize).toBe('Standard_D2s_v3');
    // Standard_D2s_v3 carries no Arm "p" marker, so the resolved image must be the x64 sku.
    expect(vm.inputs.storageProfile.imageReference.sku).toBe('server');
  });

  test('an engineer-supplied imageReference passes through verbatim', async () => {
    const customImage = { publisher: 'canonical', offer: 'ubuntu-24_04-lts', sku: 'server-gen2', version: 'latest' };
    const vm = await createVm({
      storageProfile: { imageReference: customImage, osDisk: { createOption: 'FromImage' } },
    });
    expect(vm.inputs.storageProfile.imageReference).toEqual(customImage);
  });
});

describe('VirtualMachine — hardening defaults', () => {
  beforeEach(() => {
    captured = [];
  });

  test('a machine declared bare is hardened with trusted launch, secure boot and vTPM', async () => {
    const vm = await createVm({});
    expect(vm.inputs.securityProfile).toEqual({
      securityType: 'TrustedLaunch',
      uefiSettings: { secureBootEnabled: true, vTpmEnabled: true },
    });
  });

  // Thin spot called out by the spec-review gate: host encryption must survive alongside hardening.
  test('a machine with encryption switched on keeps host encryption together with secure boot and vTPM', async () => {
    const vm = await createVm({
      enableEncryption: true,
      vaultInfo: { id: 'vault_id', resourceName: 'vault', resourceGroupName: 'rg' },
    });
    expect(vm.inputs.securityProfile).toEqual({
      securityType: 'TrustedLaunch',
      uefiSettings: { secureBootEnabled: true, vTpmEnabled: true },
      encryptionAtHost: true,
    });
  });

  test('a machine on a generation-1 image is not hardened, and the plan still succeeds', async () => {
    const vm = await createVm({
      osProfile: { windowsConfiguration: {} },
      storageProfile: {
        imageReference: { publisher: 'MicrosoftWindowsServer', offer: 'WindowsServer', sku: '2019-Datacenter' },
        osDisk: { createOption: 'FromImage' },
      },
    });
    expect(vm.inputs.securityProfile.securityType).toBeUndefined();
    expect(vm.inputs.securityProfile.uefiSettings).toBeUndefined();
  });

  test('a machine keeps the security settings the engineer chose, verbatim', async () => {
    const chosenProfile = { uefiSettings: { secureBootEnabled: false } };
    const vm = await createVm({ securityProfile: chosenProfile });
    expect(vm.inputs.securityProfile).toEqual(chosenProfile);
  });

  // Review finding 2 (DRK-793): spelling out the package's own default image is not a gen1 image.
  test('an engineer-supplied imageReference equal to the package default is still hardened', async () => {
    const vm = await createVm({
      storageProfile: {
        imageReference: { publisher: 'canonical', offer: 'ubuntu-24_04-lts', sku: 'server-arm64', version: 'latest' },
        osDisk: { createOption: 'FromImage' },
      },
    });
    expect(vm.inputs.securityProfile).toEqual({
      securityType: 'TrustedLaunch',
      uefiSettings: { secureBootEnabled: true, vTpmEnabled: true },
    });
  });

  // Review finding 3 (DRK-793): an id-only imageReference carries no gen2 marker and cannot be
  // classified, so hardening must degrade (not send TrustedLaunch and risk a gen1 deploy failure).
  test('an id-only imageReference is not hardened, but still honours enableEncryption', async () => {
    const vm = await createVm({
      enableEncryption: true,
      vaultInfo: { id: 'vault_id', resourceName: 'vault', resourceGroupName: 'rg' },
      storageProfile: {
        imageReference: { id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/images/my-image' },
        osDisk: { createOption: 'FromImage' },
      },
    });
    expect(vm.inputs.securityProfile.securityType).toBeUndefined();
    expect(vm.inputs.securityProfile.uefiSettings).toBeUndefined();
    expect(vm.inputs.securityProfile.encryptionAtHost).toBe(true);
  });
});

describe('VirtualMachine — availability zones', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('outside prd a machine with no engineer zone gets no zone', async () => {
    captured = [];
    const vm = await createVm({});
    expect(vm.inputs.zones).toBeUndefined();
  });

  test('in prd a machine with no engineer zone is placed in zone 1 and no other', () => {
    const { pulumiInstance, VirtualMachine: PrdVM, captured: prdCaptured } = withStack('prd', (p) => {
      const mod: typeof import('../../src/vm/VirtualMachine') = require('../../src/vm/VirtualMachine');
      return { pulumiInstance: p, VirtualMachine: mod.VirtualMachine };
    });

    const vm = new PrdVM('vm-prd', {
      rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
      network: { subnetId: 'subnet_id' },
    } as any);

    return pulumiInstance.output(vm.id)
      .promise()
      .then(() => {
        const created = prdCaptured.find((c) => c.type === 'azure-native:compute:VirtualMachine')!;
        expect(created.inputs.zones).toEqual(['1']);
      });
  });

  test('in prd a machine stating zone 3 is placed in zone 3, verbatim', () => {
    const { pulumiInstance, VirtualMachine: PrdVM, captured: prdCaptured } = withStack('prd', (p) => {
      const mod: typeof import('../../src/vm/VirtualMachine') = require('../../src/vm/VirtualMachine');
      return { pulumiInstance: p, VirtualMachine: mod.VirtualMachine };
    });

    const vm = new PrdVM('vm-prd-z3', {
      rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
      network: { subnetId: 'subnet_id' },
      zones: ['3'],
    } as any);

    return pulumiInstance.output(vm.id)
      .promise()
      .then(() => {
        const created = prdCaptured.find((c) => c.type === 'azure-native:compute:VirtualMachine')!;
        expect(created.inputs.zones).toEqual(['3']);
      });
  });
});

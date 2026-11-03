import { withStack, settle, registrationOf, quietStackHooks, dropExitListenerHooks } from '../testUtils/pulumiMocks';

// DRK-2529 §5 acceptance tests: Feature "Virtual machine disks default to Standard SSD".
// Spec labels map to Azure managed-disk enum literals: "Standard SSD with local redundancy" = StandardSSD_LRS,
// "Premium SSD" = Premium_LRS, "Standard HDD" = Standard_LRS.

const VM = 'azure-native:compute:VirtualMachine';

async function buildVm(stack: string, name: string, props: any) {
  const { pulumi, VirtualMachine, captured } = withStack(stack, (p) => {
    const mod: typeof import('../../src/vm/VirtualMachine') = require('../../src/vm/VirtualMachine');
    return { pulumi: p, VirtualMachine: mod.VirtualMachine };
  });
  const vm = new VirtualMachine(name, {
    rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
    network: { subnetId: 'subnet_id' },
    ...props,
  } as any);
  await settle(pulumi, vm.id);
  return registrationOf(captured, VM, name).storageProfile;
}

const dataDisks = (count: number, diskSizeGB: number) =>
  Array.from({ length: count }, (_, lun) => ({ lun, createOption: 'Empty', diskSizeGB }));

describe('Feature: Virtual machine disks default to Standard SSD', () => {
  quietStackHooks();
  dropExitListenerHooks();

  test.each(['dev', 'prd'])(
    'Scenario Outline: A virtual machine with no disk type gets a Standard SSD OS disk in every environment (stack %s)',
    async (stack) => {
      const storage = await buildVm(stack, 'app-vm', {});

      expect(storage.osDisk.managedDisk.storageAccountType).toBe('StandardSSD_LRS');
    },
  );

  test('Scenario: Every data disk of a virtual machine with no disk type is Standard SSD', async () => {
    const storage = await buildVm('dev', 'data-vm', {
      storageProfile: { osDisk: { createOption: 'FromImage' }, dataDisks: dataDisks(2, 128) },
    });

    expect(storage.dataDisks).toHaveLength(2);
    expect(storage.dataDisks[0].managedDisk.storageAccountType).toBe('StandardSSD_LRS');
    expect(storage.dataDisks[1].managedDisk.storageAccountType).toBe('StandardSSD_LRS');
  });

  test.each([
    ['Premium SSD', 'Premium_LRS'],
    ['Standard HDD', 'Standard_LRS'],
  ])(
    'Scenario Outline: A disk type the engineer sets is used for every disk (disk type %s)',
    async (_label, storageAccountType) => {
      const storage = await buildVm('dev', 'custom-vm', {
        storageProfile: { osDisk: { createOption: 'FromImage' }, dataDisks: dataDisks(1, 64), storageAccountType },
      });

      expect(storage.osDisk.managedDisk.storageAccountType).toBe(storageAccountType);
      expect(storage.dataDisks).toHaveLength(1);
      expect(storage.dataDisks[0].managedDisk.storageAccountType).toBe(storageAccountType);
    },
  );

  test('Scenario: Disk encryption stays linked to every disk under the new default', async () => {
    const storage = await buildVm('dev', 'secure-vm', {
      enableEncryption: true,
      diskEncryptionSet: { id: 'secure-des' },
      storageProfile: { osDisk: { createOption: 'FromImage' }, dataDisks: dataDisks(1, 64) },
    });

    expect(storage.osDisk.managedDisk.diskEncryptionSet).toEqual({ id: 'secure-des' });
    expect(storage.dataDisks).toHaveLength(1);
    expect(storage.dataDisks[0].managedDisk.diskEncryptionSet).toEqual({ id: 'secure-des' });
  });
});

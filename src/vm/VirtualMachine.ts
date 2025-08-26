import * as compute from '@pulumi/azure-native/compute';
import * as devtestlab from '@pulumi/azure-native/devtestlab';
import * as nw from '@pulumi/azure-native/network';
import * as inputs from '@pulumi/azure-native/types/input';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';

export type VmScheduleType = {
  /** The time zone ID: https://stackoverflow.com/questions/7908343/list-of-timezone-ids-for-use-with-findtimezonebyid-in-c */
  timeZone?: 'Singapore Standard Time' | pulumi.Input<string>;
  /** The format is ISO 8601 Standard ex: 2200 */
  autoShutdownTime: pulumi.Input<string>;
  /** The format is ISO 8601 Standard ex: 0900 */
  //autoStartTime?: Input<string>;
  emailNotification?: string[];
  webHook?: pulumi.Input<string>;
};

export interface VirtualMachineArgs
  extends CommonBaseArgs,
    types.WithUserAssignedIdentity,
    types.WithEncryptionEnabler,
    types.WithDiskEncryptSet,
    Omit<
      compute.VirtualMachineArgs,
      'osProfile' | 'storageProfile' | 'identity' | 'networkProfile' | 'resourceGroupName' | 'location'
    > {
  osProfile?: Omit<inputs.compute.OSProfileArgs, 'adminPassword' | 'adminUsername'>;
  storageProfile: Partial<
    Pick<inputs.compute.StorageProfileArgs, 'imageReference' | 'alignRegionalDisksToVMZone' | 'diskControllerType'>
  > & {
    osDisk: Omit<inputs.compute.OSDiskArgs, 'encryptionSettings'>;
    dataDisks?: Omit<inputs.compute.DataDiskArgs, 'managedDisk'>[];
    storageAccountType?: compute.StorageAccountTypes;
    securityEncryptionType?: compute.SecurityEncryptionTypes;
  };
  network: {
    subnetId: pulumi.Input<string>;
    nicType?: nw.NetworkInterfaceNicType;
  };
  schedule?: VmScheduleType;
  extensions?: Array<
    Omit<compute.VirtualMachineExtensionArgs, 'location' | 'resourceGroupName' | 'vmName' | 'vmExtensionName'> & {
      name: string;
    }
  >;
  lock?: boolean;
}

export class VirtualMachine extends BaseResourceComponent<VirtualMachineArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: VirtualMachineArgs, opts?: pulumi.ComponentResourceOptions) {
    super('VirtualMachine', name, args, opts);

    const {
      rsGroup,
      defaultUAssignedId,
      enableEncryption,
      osProfile,
      storageProfile,
      vaultInfo,
      diskEncryptionSet,
      lock,
      ...props
    } = args;

    const adminLogin = pulumi.interpolate`${this.name}-vn-admin-${
      this.createRandomString({ type: 'string', length: 6 }).value
    }`;
    const password = this.createPassword();
    const keyEncryption = enableEncryption ? this.getEncryptionKey({ name: 'key' }) : undefined;
    const diskEncryption = enableEncryption ? this.getEncryptionKey({ name: 'disk' }) : undefined;
    const nic = this.createNetworkInterface();

    const vm = new compute.VirtualMachine(
      this.name,
      {
        ...props,
        ...rsGroup,

        identity: {
          type: defaultUAssignedId
            ? compute.ResourceIdentityType.SystemAssigned_UserAssigned
            : compute.ResourceIdentityType.SystemAssigned,
          userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
        },

        networkProfile: {
          networkInterfaces: [{ id: nic.id, primary: true }],
        },
        //az feature register --name EncryptionAtHost  --namespace Microsoft.Compute
        securityProfile: props.securityProfile ?? { encryptionAtHost: true },
        osProfile: {
          ...osProfile,
          adminUsername: adminLogin,
          adminPassword: password.value,
        },
        storageProfile: {
          ...storageProfile,
          osDisk: {
            ...storageProfile.osDisk,

            encryptionSettings:
              diskEncryption && keyEncryption
                ? {
                    diskEncryptionKey: diskEncryption
                      ? {
                          secretUrl: diskEncryption.id,
                          sourceVault: {
                            id: vaultInfo!.id,
                          },
                        }
                      : undefined,
                    keyEncryptionKey: keyEncryption
                      ? {
                          keyUrl: keyEncryption.id,
                          sourceVault: {
                            id: vaultInfo!.id,
                          },
                        }
                      : undefined,
                    enabled: enableEncryption,
                  }
                : undefined,

            managedDisk: {
              diskEncryptionSet: diskEncryptionSet
                ? {
                    id: diskEncryptionSet.id,
                  }
                : undefined,
              securityProfile: {
                diskEncryptionSet: diskEncryptionSet ? { id: diskEncryptionSet.id } : undefined,
                securityEncryptionType: storageProfile.securityEncryptionType,
              },
              storageAccountType: storageProfile.storageAccountType ?? compute.StorageAccountTypes.Standard_LRS,
            },
          },

          dataDisks: storageProfile.dataDisks
            ? storageProfile.dataDisks.map((d) => ({
                ...d,
                managedDisk: {
                  diskEncryptionSet: diskEncryptionSet
                    ? {
                        id: diskEncryptionSet.id,
                      }
                    : undefined,
                  securityProfile: {
                    diskEncryptionSet: diskEncryptionSet ? { id: diskEncryptionSet.id } : undefined,
                    securityEncryptionType: storageProfile.securityEncryptionType,
                  },
                  storageAccountType: storageProfile.storageAccountType ?? compute.StorageAccountTypes.Standard_LRS,
                },
              }))
            : [],
        },
      },
      {
        ...opts,
        protect: lock,
        parent: this,
      },
    );

    this.createSchedule(vm);
    this.createExtensions(vm);
    if (lock) this.lockFromDeleting(vm);

    this.addSecrets({
      login: adminLogin,
      pass: password.value,
    });

    this.id = vm.id;
    this.resourceName = vm.name;

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }
  private createNetworkInterface() {
    const { rsGroup, network } = this.args;
    return new nw.NetworkInterface(this.name, {
      ...rsGroup,
      ipConfigurations: [{ name: 'ipconfig', subnet: { id: network.subnetId }, primary: true }],
      nicType: network.nicType ?? nw.NetworkInterfaceNicType.Standard,
    });
  }

  private createSchedule(vm: compute.VirtualMachine) {
    const { rsGroup, schedule } = this.args;
    if (!schedule) return undefined;
    return new devtestlab.GlobalSchedule(
      this.name,
      {
        ...rsGroup,
        dailyRecurrence: { time: schedule.autoShutdownTime },
        timeZoneId: schedule.timeZone,
        status: 'Enabled',
        targetResourceId: vm.id,
        taskType: 'ComputeVmShutdownTask',
        notificationSettings: {
          status: schedule.webHook || schedule.emailNotification ? 'Enabled' : 'Disabled',
          emailRecipient: schedule.emailNotification?.join(';'),
          notificationLocale: 'en',
          timeInMinutes: 30,
          webhookUrl: schedule.webHook,
        },
      },
      { dependsOn: vm, parent: this },
    );
  }

  private createExtensions(vm: compute.VirtualMachine) {
    const { rsGroup, extensions } = this.args;
    if (!extensions) return extensions;
    extensions.map(
      (ex) =>
        new compute.VirtualMachineExtension(
          `${this.name}-${ex.name}`,
          {
            ...ex,
            ...rsGroup,
            vmExtensionName: ex.name,
            vmName: vm.name,
          },
          { dependsOn: vm, parent: this },
        ),
    );
  }
}

import * as compute from '@pulumi/azure-native/compute';
import * as mnc from '@pulumi/azure-native/maintenance';
import * as devtestlab from '@pulumi/azure-native/devtestlab';
import * as nw from '@pulumi/azure-native/network';
import * as inputs from '@pulumi/azure-native/types/input';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';
import { rsHelpers, zoneHelper } from '../helpers';
import { MaintenanceConfigurationArgs } from '@pulumi/azure-native/maintenance/maintenanceConfiguration';

export type VmScheduleType = {
  /** The time zone ID: https://stackoverflow.com/questions/7908343/list-of-timezone-ids-for-use-with-findtimezonebyid-in-c */
  timeZone?: 'Singapore Standard Time' | pulumi.Input<string>;
  /** The format is ISO 8601 Standard ex: 2200 */
  autoShutdownTime: pulumi.Input<string>;
  /** The format is ISO 8601 Standard ex: 0900 */
  autoStartTime?: pulumi.Input<string>;
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
  enableAutoUpdates?: boolean;
  maintenance?: Pick<mnc.MaintenanceConfigurationArgs, 'recurEvery'|'timeZone'|'duration'|'maintenanceScope'>;
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
      enableAutoUpdates,
      ...props
    } = args;

    const keyEncryption = enableEncryption && !diskEncryptionSet ? this.getEncryptionKey({ name: 'key' }) : undefined;
    const diskEncryption = enableEncryption && !diskEncryptionSet ? this.getEncryptionKey({ name: 'disk' }) : undefined;
    const nic = this.createNetworkInterface();
    const credential = this.createCredentials();

    const vm = new compute.VirtualMachine(
      this.name,
      {
        ...props,
        ...rsGroup,
        zones: zoneHelper.getDefaultZones(props.zones),

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
        securityProfile: props.securityProfile ?? {
          encryptionAtHost: true,
        },
        osProfile: {
          ...osProfile,
          adminUsername: credential.login,
          adminPassword: credential.pass,
          ...(enableAutoUpdates
            ? {
                windowsConfiguration: {
                  enableAutomaticUpdates: true,
                  ...osProfile?.windowsConfiguration,
                },
                linuxConfiguration: {
                  patchSettings: {
                    patchMode: 'AutomaticByPlatform',
                    assessmentMode: 'AutomaticByPlatform',
                  },
                  ...osProfile?.linuxConfiguration,
                },
              }
            : {}),
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
                          secretUrl: pulumi.interpolate`${diskEncryption.vaultUrl}/secrets/${diskEncryption.keyName}/${diskEncryption.version}`,
                          sourceVault: {
                            id: vaultInfo!.id,
                          },
                        }
                      : undefined,
                    keyEncryptionKey: keyEncryption
                      ? {
                          keyUrl: pulumi.interpolate`${keyEncryption.vaultUrl}/keys/${keyEncryption.keyName}/${keyEncryption.version}`,
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

              securityProfile: storageProfile.securityEncryptionType
                ? {
                    diskEncryptionSet: diskEncryptionSet ? { id: diskEncryptionSet.id } : undefined,
                    securityEncryptionType: storageProfile.securityEncryptionType,
                  }
                : undefined,
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
                  securityProfile: storageProfile.securityEncryptionType
                    ? {
                        diskEncryptionSet: diskEncryptionSet ? { id: diskEncryptionSet.id } : undefined,
                        securityEncryptionType: storageProfile.securityEncryptionType,
                      }
                    : undefined,
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
    this.createMaintenance(vm);
    if (lock) this.lockFromDeleting(vm);

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

  private createCredentials() {
    const adminLogin = pulumi.interpolate`${this.name}-admin-${
      this.createRandomString({ type: 'string', length: 6 }).value
    }`.apply((s) => rsHelpers.removeDashes(s.substring(0, 20)));

    const password = this.createPassword();

    this.addSecrets({
      login: adminLogin,
      pass: password.value,
    });

    return { login: adminLogin, pass: password.value };
  }

  private createNetworkInterface() {
    const { rsGroup, network } = this.args;
    return new nw.NetworkInterface(
      this.name,
      {
        ...rsGroup,
        ipConfigurations: [{ name: 'ipconfig', subnet: { id: network.subnetId }, primary: true }],
        nicType: network.nicType ?? nw.NetworkInterfaceNicType.Standard,
      },
      { ...this.opts, parent: this },
    );
  }

  private createSchedule(vm: compute.VirtualMachine) {
    const { rsGroup, schedule } = this.args;
    if (!schedule) return;

    vm.name.apply((n) => {
      if (schedule.autoShutdownTime) {
        new devtestlab.GlobalSchedule(
          `shutdown-computevm-${n}`,
          {
            ...rsGroup,
            name: `shutdown-computevm-${n}`,
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
          { dependsOn: vm, parent: this, deleteBeforeReplace: true, deletedWith: vm },
        );
      }

      if (schedule.autoStartTime) {
        new devtestlab.GlobalSchedule(
          `startup-computevm-${n}`,
          {
            ...rsGroup,
            name: `startup-computevm-${n}`,
            dailyRecurrence: { time: schedule.autoStartTime },

            timeZoneId: schedule.timeZone,
            status: 'Enabled',
            targetResourceId: vm.id,
            taskType: 'ComputeVmStartupTask',

            notificationSettings: {
              status: schedule.webHook || schedule.emailNotification ? 'Enabled' : 'Disabled',
              emailRecipient: schedule.emailNotification?.join(';'),
              notificationLocale: 'en',
              timeInMinutes: 30,
              webhookUrl: schedule.webHook,
            },
          },
          { dependsOn: vm, parent: this, deleteBeforeReplace: true, deletedWith: vm },
        );
      }
    });
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

  private createMaintenance(vm: compute.VirtualMachine) {
    const { rsGroup, maintenance } = this.args;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startDate = tomorrow.toISOString().split('T')[0];

    const config = new mnc.MaintenanceConfiguration(
      `${this.name}-maintenance`,
      {
        ...rsGroup,
        maintenanceScope:maintenance?.maintenanceScope?? mnc.MaintenanceScope.OSImage,
        timeZone: maintenance?.timeZone??"Singapore Standard Time",
        visibility: 'Custom',
        duration: maintenance?.duration??"04:00",
        startDateTime: startDate,
        recurEvery: maintenance?.recurEvery??'1Week Saturday,Sunday',
        extensionProperties: {
          InGuestPatchMode: 'User',
        },
      },
      { dependsOn: vm, parent: this,deletedWith:vm },
    );

    return new mnc.ConfigurationAssignment("${this.name}-maintenance-assignment", {
      ...rsGroup,
      resourceName:vm.name,
      maintenanceConfigurationId:config.id,
      resourceId:vm.id,
      resourceType:"VirtualMachine",
      providerName: "Microsoft.Compute",
    },
      { dependsOn: vm, parent: this,deletedWith:vm });
  }
}

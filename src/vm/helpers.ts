import * as compute from '@pulumi/azure-native/compute';
import * as pulumi from '@pulumi/pulumi';

export function getAzDevOpsExtension({
  protectedSettings,
  settings,
}: {
  settings: {
    VSTSAccountUrl: pulumi.Input<string>;
    TeamProject: pulumi.Input<string>;
    DeploymentGroup: pulumi.Input<string>;
    AgentName: pulumi.Input<string>;
    Tags?: pulumi.Input<string>;
  };
  protectedSettings: {
    PATToken: pulumi.Input<string>;
  };
}): Omit<compute.VirtualMachineExtensionArgs, 'location' | 'resourceGroupName' | 'vmName' | 'vmExtensionName'> & {
  name: string;
} {
  return {
    name: 'azure-devops-agent',
    autoUpgradeMinorVersion: true,
    protectedSettings,
    settings,
    publisher: 'Microsoft.VisualStudio.Services',
    type: 'TeamServicesAgentLinux',
    typeHandlerVersion: '1.0',
  };
}

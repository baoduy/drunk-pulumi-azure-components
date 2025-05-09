import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';
import * as azureEnv from './azureEnv';
import * as stackInfo from './stackEnv';

export const removeLeadingAndTrailingDash = (s: string) => s.replace(/^-+|-+$/g, '');

export function getShortName(name: string) {
  const n = name.replace(stackInfo.organization, '').replace(stackInfo.projectName, '').replace(stackInfo.stack, '');
  return removeLeadingAndTrailingDash(n);
}

/** The method to get Resource group Name*/
export const getRsGroupIdFrom = (rsGroup: types.ResourceGroupInputs) =>
  pulumi.interpolate`${azureEnv.defaultSubScope}/resourceGroups/${rsGroup.resourceGroupName}`;

export function getRsNameFromId(resourceId: string) {
  resourceId = resourceId.trim();
  //Resource ID
  if (resourceId.includes('/')) {
    return resourceId.split('/').pop();
  }
  //Domain
  if (resourceId.includes('.')) return resourceId.split('.')[0];
  //If not just get last 25 character
  return resourceId.slice(-25);
}

export function getRsNameFromIdOutput(resourceId: pulumi.Input<string>) {
  return pulumi.output(resourceId).apply((id) => getRsNameFromId(id));
}

export function getRsInfoFromId(
  resourceId: string,
): types.ResourceWithGroupType & { id: string; subscriptionId: string } {
  const details = resourceId.trim().split('/');
  let name = '';
  let groupName = '';
  let subId = '';

  details.forEach((d, index) => {
    if (d === 'subscriptions') subId = details[index + 1];
    if (d === 'resourceGroups' || d === 'resourcegroups') groupName = details[index + 1];
    if (index === details.length - 1) name = d;
  });

  return {
    resourceName: name,
    id: resourceId,
    rsGroup: { resourceGroupName: groupName },
    subscriptionId: subId ?? azureEnv.subscriptionId,
  };
}

export function getRsInfoFromIdOutputs(resourceId: pulumi.Input<string>) {
  return pulumi.output(resourceId).apply((id) => getRsInfoFromId(id));
}

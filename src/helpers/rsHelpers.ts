import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';
import * as azureEnv from './azureEnv';
import * as stackInfo from './stackEnv';

/**
 * Delays the execution for a specified amount of time.
 * @param ms - The number of milliseconds to delay.
 * @returns A promise that resolves after the specified delay.
 */
export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Removes leading and trailing dashes from a string and replaces multiple consecutive dashes with a single dash
 * @param s - The input string to process
 * @returns The string with leading/trailing dashes removed and multiple dashes replaced with single dash
 * @example
 * removeDashes("--test--") // returns "test"
 * removeDashes("hello--world--test") // returns "hello-world-test"
 */
export function removeDashes(s: string) {
  return s.replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
}

/**
 * Normalizes a name by replacing non-alphanumeric characters with dashes and removing leading/trailing dashes
 * @param name - The input name to normalize
 * @returns The normalized name
 */
export function getNameNormalized(name: string) {
  const n = name
    .replace(/[^a-zA-Z0-9]/g, '-') // Replace any non-alphanumeric character with "-"
    .toLowerCase(); // Convert the result to lowercase
  return removeDashes(n);
}

/**
 * Gets a shortened name by removing organization, project name and stack information
 * @param name - The full resource name
 * @returns Shortened name with organization, project and stack info removed
 * @example
 * getShortName("org-project-stack-resource") // returns "resource"
 */
export function getShortName(name: string) {
  const n = name.replace(stackInfo.organization, '').replace(stackInfo.projectName, '').replace(stackInfo.stack, '');
  return removeDashes(n);
}

/**
 * Generates the full Azure resource group ID from resource group inputs
 * @param rsGroup - The resource group input object containing the resource group name
 * @returns A Pulumi interpolated string with the full resource group ID
 * @example
 * getRsGroupIdFrom({resourceGroupName: "my-rg"}) // returns "/subscriptions/sub-id/resourceGroups/my-rg"
 */
export const getRsGroupIdFrom = (rsGroup: types.ResourceGroupInputs) =>
  pulumi.interpolate`${azureEnv.defaultSubScope}/resourceGroups/${rsGroup.resourceGroupName}`;

/**
 * Extracts the resource name from a resource ID or domain
 * @param resourceId - The resource identifier (can be a resource ID, domain, or plain string)
 * @returns The extracted resource name
 * @example
 * getRsNameFromId("/subscriptions/sub-id/resourceGroups/rg/providers/Microsoft.Web/sites/my-site") // returns "my-site"
 * getRsNameFromId("my-site.azurewebsites.net") // returns "my-site"
 */
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

/**
 * Converts a Pulumi Input string resource ID to an Output containing just the resource name
 * @param resourceId - The Pulumi Input string containing the resource ID
 * @returns A Pulumi Output containing the extracted resource name
 */
export function getRsNameFromIdOutput(resourceId: pulumi.Input<string>) {
  return pulumi.output(resourceId).apply((id) => getRsNameFromId(id));
}

/**
 * Parses an Azure resource ID string to extract resource information
 * @param resourceId - The full Azure resource ID string
 * @returns An object containing the resource name, ID, resource group, and subscription ID
 * @example
 * getRsInfoFromId("/subscriptions/sub123/resourceGroups/rg-name/providers/Microsoft.Web/sites/site-name")
 * // returns {
 * //   resourceName: "site-name",
 * //   id: "/subscriptions/sub123/resourceGroups/rg-name/providers/Microsoft.Web/sites/site-name",
 * //   rsGroup: { resourceGroupName: "rg-name" },
 * //   subscriptionId: "sub123"
 * // }
 */
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

/**
 * Converts a Pulumi Input string resource ID to an Output containing parsed resource information
 * @param resourceId - The Pulumi Input string containing the resource ID
 * @returns A Pulumi Output containing the parsed resource information
 */
export function getRsInfoFromIdOutputs(resourceId: pulumi.Input<string>) {
  return pulumi.output(resourceId).apply((id) => getRsInfoFromId(id));
}

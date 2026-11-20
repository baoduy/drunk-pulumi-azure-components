import * as ccs from '@pulumi/azure-native/containerservice';
import * as pulumi from '@pulumi/pulumi';
import type { AzKubernetesArgs } from './AzKubernetes';

/** The Azure container-service API an AKS Automatic cluster is created through: the first with `hostedSystemProfile`. */
export const AKS_AUTOMATIC_API_VERSION = '2026-02-01';

const SUBNET_INPUTS = ['apiServerSubnetId', 'systemNodeSubnetId', 'workloadNodeSubnetId'] as const;

const OR_BASE = "or set `sku.name: 'Base'` for a Base cluster";

/** A value known now: neither an Output nor a Promise. */
const isLiteral = <T>(value: pulumi.Input<T> | undefined): value is T | undefined =>
  !pulumi.Output.isInstance(value) && !(value instanceof Promise);

/** The VNet ID of the API server subnet: its ID without the `/subnets/<name>` segment, matched in any case. */
const toVnetId = (subnetId: string) => {
  const match = /^(.+)\/subnets\/[^/]+$/i.exec(subnetId);
  if (!match) {
    throw new Error(
      `\`network.apiServerSubnetId\` '${subnetId}' is not a subnet ID: it has no \`/subnets/<name>\` segment.`,
    );
  }
  return match[1];
};

/** The upgrade channels an Automatic cluster runs on: the caller's, each left out one Stable / NodeImage. */
export const automaticUpgradeProfile = (profile: AzKubernetesArgs['autoUpgradeProfile']) =>
  pulumi.output(profile).apply((p) => ({
    upgradeChannel: p?.upgradeChannel ?? ccs.UpgradeChannel.Stable,
    nodeOSUpgradeChannel: p?.nodeOSUpgradeChannel ?? ccs.NodeOSUpgradeChannel.NodeImage,
  }));

/**
 * Refuses every input an AKS Automatic cluster cannot take, naming the input, before any child resource registers.
 * The upgrade channels and an extra pool's `enableAutoScaling` must be literal values: an Output or a Promise is
 * refused, since it is only known after resources are registered.
 * Returns the VNet of the API server subnet, the scope of the cluster identity's network grant.
 */
export function checkAutomaticArgs(name: string, args: AzKubernetesArgs) {
  const { network, features, autoUpgradeProfile } = args;

  const check = <T>(input: string, value: T, allowed: (v: T) => boolean, rule: string) => {
    if (!allowed(value)) throw new Error(`AzKubernetes '${name}' is an AKS Automatic cluster: \`${input}\` ${rule}.`);
  };
  /** Like `check`, for an input that must also be a literal value. */
  const checkLiteral = <T>(
    input: string,
    value: pulumi.Input<T> | undefined,
    allowed: (v: T | undefined) => boolean,
    rule: string,
  ) => {
    check(input, value, isLiteral, 'must be a literal value, not an Output or a Promise');
    check(input, value as T | undefined, allowed, rule);
  };
  const channel = (key: 'upgradeChannel' | 'nodeOSUpgradeChannel'): pulumi.Input<string | undefined> =>
    isLiteral(autoUpgradeProfile)
      ? autoUpgradeProfile?.[key]
      : pulumi.output(autoUpgradeProfile).apply((p) => p?.[key]);

  for (const key of SUBNET_INPUTS) {
    check(`network.${key}`, network?.[key], Boolean, `is required: give the subnet ID, ${OR_BASE}`);
  }
  check(
    'agentPoolProfiles',
    args.agentPoolProfiles,
    (pools) => !pools?.length,
    'must be left out or empty: AKS runs the system nodes',
  );

  const alwaysOn = 'cannot be false: an Automatic cluster always turns it on';
  check('features.enableWorkloadIdentity', features.enableWorkloadIdentity, (v) => v !== false, alwaysOn);
  check('features.enableKeda', features.enableKeda, (v) => v !== false, alwaysOn);
  check('features.enableVerticalPodAutoscaler', features.enableVerticalPodAutoscaler, (v) => v !== false, alwaysOn);
  check('features.enableNodeAutoProvisioning', features.enableNodeAutoProvisioning, (v) => v !== false, alwaysOn);
  check(
    'features.enablePodIdentity',
    features.enablePodIdentity,
    (v) => v !== true,
    'cannot be true: an Automatic cluster uses workload identity',
  );
  check(
    'enableResourceIdentity',
    args.enableResourceIdentity,
    (v) => v !== true,
    'cannot be true: the cluster signs in with its own user-assigned identity',
  );
  check(
    'network.virtualHostSubnetName',
    network?.virtualHostSubnetName,
    (v) => !v,
    'cannot be set: an Automatic cluster has no virtual nodes',
  );
  checkLiteral(
    'autoUpgradeProfile.upgradeChannel',
    channel('upgradeChannel'),
    (v) => v === undefined || v === ccs.UpgradeChannel.Stable,
    `must be left out or '${ccs.UpgradeChannel.Stable}'`,
  );
  checkLiteral(
    'autoUpgradeProfile.nodeOSUpgradeChannel',
    channel('nodeOSUpgradeChannel'),
    (v) => v === undefined || v === ccs.NodeOSUpgradeChannel.NodeImage,
    `must be left out or '${ccs.NodeOSUpgradeChannel.NodeImage}'`,
  );
  for (const pool of args.extraAgentPoolProfiles ?? []) {
    checkLiteral(
      'extraAgentPoolProfiles',
      pool.enableAutoScaling,
      (v) => v === undefined || v === false,
      `pool '${pool.name}' cannot autoscale: node auto-provisioning scales an Automatic cluster`,
    );
  }
  const customerKey = `cannot be used: an Automatic cluster refuses customer-key disk encryption; remove it, ${OR_BASE}`;
  check('enableEncryption', args.enableEncryption, (v) => v !== true, customerKey);
  check('diskEncryptionSet', args.diskEncryptionSet, (v) => !v, customerKey);

  const apiServerSubnetId = network!.apiServerSubnetId!;
  const vnetId = isLiteral(apiServerSubnetId)
    ? toVnetId(apiServerSubnetId)
    : pulumi.output(apiServerSubnetId).apply(toVnetId);
  return { vnetId };
}

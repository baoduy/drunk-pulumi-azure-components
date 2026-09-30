import type { NetworkArgs } from '../types';
import { isPrd } from './azureEnv';

/** True when the caller supplied IP or virtual-network rules, which force `defaultAction: 'Deny'`. */
export const hasNetworkRules = (network?: Pick<NetworkArgs, 'ipRules' | 'vnetRules'>) =>
  Boolean(network?.ipRules || network?.vnetRules);

/**
 * True when a rules input restricts access. A plain empty array does not: Azure lets all traffic in when
 * `defaultAction` is `Deny` with zero rules. An unresolved `Output`/`Promise` cannot be inspected at
 * construction, so it counts as a restriction.
 */
const isRestriction = (rules: unknown) => (Array.isArray(rules) ? rules.length > 0 : Boolean(rules));

/**
 * Production guard (PULUMI-SEC-006): in a prd stack a resource must not be reachable from the
 * public internet. It is accepted only when it is private-link-only (`privateLink` set and
 * `publicNetworkAccess` not `true`) or, unless `privateLinkOnly`, restricted by a non-empty `ipRules` /
 * `vnetRules` (an empty plain array is not a restriction; an unresolved `Output` counts as one).
 * Anything else throws, naming the component type and resource name.
 * Outside prd this is a no-op.
 *
 * Breaking since DRK-1817: prd AppConfig, KeyVault and ServiceBus without one of these shapes
 * now fail at construction instead of deploying open. Fix the caller by adding `network.privateLink`
 * (or `network.ipRules` / `network.vnetRules` where the resource supports a firewall).
 *
 * @param type - component type, e.g. `KeyVault`
 * @param name - the component's resource name
 * @param network - the caller's network args
 * @param options.privateLinkOnly - the resource has no IP firewall (App Configuration), so rules do not count
 */
export function assertPrdNetworkRestricted(
  type: string,
  name: string,
  network: NetworkArgs | undefined,
  options: { privateLinkOnly?: boolean } = {},
) {
  if (!isPrd) return;

  const privateOnly = Boolean(network?.privateLink) && !network?.publicNetworkAccess;
  const restricted = isRestriction(network?.ipRules) || isRestriction(network?.vnetRules);
  if (privateOnly || (!options.privateLinkOnly && restricted)) return;

  const accepted = options.privateLinkOnly
    ? '`network.privateLink` without `publicNetworkAccess: true`'
    : '`network.privateLink` without `publicNetworkAccess: true`, or `network.ipRules` / `network.vnetRules`';
  throw new Error(`${type} '${name}' is open to the internet, which is not allowed in prd. Use ${accepted}.`);
}

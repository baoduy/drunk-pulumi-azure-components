/**
 * @module azureEnv
 * @description Module for handling Azure environment configuration and settings
 */

import { authorization } from '@pulumi/azure-native';
import * as pulumi from '@pulumi/pulumi';
import { getCountryCode, getRegionCode } from './Location';
import { stack } from './stackEnv';

/**
 * @enum {string}
 * @description Enumeration of supported Azure deployment environments
 */
export enum Environments {
  Global = 'global',
  Dev = 'dev',
  Sandbox = 'sandbox',
  Prd = 'prd',
}

/**
 * @constant {Object} azEnv
 * @description Parsed Pulumi configuration from environment variables
 */
const azEnv = JSON.parse(process.env.PULUMI_CONFIG ?? '{}');

/**
 * @constant {Output} config
 * @description Azure client configuration output
 */
const config = authorization.getClientConfigOutput();

/**
 * @constant {Output<string>} tenantId
 * @description Azure tenant ID from config or client config
 */
export const tenantId = azEnv['azure-native:config:tenantId'] ?? config.tenantId;

/**
 * @constant {Output<string>} subscriptionId
 * @description Azure subscription ID from config or client config
 */
export const subscriptionId = azEnv['azure-native:config:subscriptionId'] ?? config.subscriptionId;

/**
 * @constant {Output<string>} currentPrincipal
 * @description Current Azure principal object ID
 */
export const currentPrincipal = config.objectId;

/**
 * @constant {string} currentRegionName
 * @description Current Azure region name, defaults to 'SoutheastAsia'
 */
export const currentRegionName = (azEnv['azure-native:config:location'] ?? 'SoutheastAsia') as string;

/**
 * @constant {string} currentRegionCode
 * @description Region code derived from current region name
 */
export const currentRegionCode = getRegionCode(currentRegionName);

/**
 * @constant {string} currentCountryCode
 * @description Country code derived from current region name
 */
export const currentCountryCode = getCountryCode(currentRegionName);

/**
 * @constant {Output<string>} defaultSubScope
 * @description Default subscription scope string
 */
export const defaultSubScope = pulumi.interpolate`/subscriptions/${subscriptionId}`;

/**
 * @function isEnv
 * @description Checks if current stack includes specified environment
 * @param {Environments} env - Environment to check
 * @returns {boolean} True if stack includes the environment
 */
export const isEnv = (env: Environments) => stack.includes(env);

/**
 * @constant {boolean} isDev
 * @description Indicates if current environment is Development
 */
export const isDev = isEnv(Environments.Dev);

/**
 * @constant {boolean} isSandbox
 * @description Indicates if current environment is Sandbox
 */
export const isSandbox = isEnv(Environments.Sandbox);

/**
 * @constant {boolean} isPrd
 * @description Indicates if current environment is Production
 */
export const isPrd = isEnv(Environments.Prd);

/**
 * @constant {boolean} isGlobal
 * @description Indicates if current environment is Global
 */
export const isGlobal = isEnv(Environments.Global);

/**
 * @function getCurrentEnv
 * @description Determines current environment based on environment flags
 * @returns {Environments} Current environment enum value
 */
function getCurrentEnv() {
  if (isGlobal) return Environments.Global;
  if (isPrd) return Environments.Prd;
  if (isSandbox) return Environments.Sandbox;
  return Environments.Dev;
}

/**
 * @constant {Environments} currentEnv
 * @description Current environment value
 */
export const currentEnv = getCurrentEnv();

//Print and Check
pulumi.all([subscriptionId, tenantId, currentPrincipal]).apply(([s, t, p]) => {
  console.log(`Azure Environment:`, {
    tenantId: t,
    subscriptionId: s,
    principalId: p,
    currentRegionCode,
    currentRegionName,
    currentCountryCode,
    currentEnv,
  });
});

export const entraIdAuthorityUrl = pulumi.interpolate`https://login.microsoftonline.com/${tenantId}/v2.0`;

/**
 * @constant {string[]} defaultAzurePorts
 * @description List of default Azure ports commonly used in network security rules
 * @property {string} 22 - SSH
 * @property {string} 443 - HTTPS
 * @property {string} 445 - SMB
 * @property {string} 1433 - MSSQL
 * @property {string} 1194 - OpenVPN
 * @property {string} 3306 - MySQL
 * @property {string} 3389 - RDP
 * @property {string} 5432 - PostgreSQL
 * @property {string} 5671 - AMQP with TLS
 * @property {string} 5672 - AMQP
 * @property {string} 6379 - Redis
 * @property {string} 6380 - Redis with TLS
 * @property {string} 8883 - MQTT
 * @property {string} 9000 - Azure Storage
 * @property {string} 10255 - Kubernetes
 */
export const defaultAzurePorts = [
  '22',
  '443',
  '445',
  '1433',
  '1194',
  '3306',
  '3389',
  '5432',
  '5671',
  '5672',
  '6379',
  '6380',
  '8883',
  '9000',
  '10255',
];

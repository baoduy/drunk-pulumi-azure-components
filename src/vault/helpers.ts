import { rsHelpers, stackInfo } from '../helpers';
import * as pulumi from '@pulumi/pulumi';
import getKeyVaultBase from '@drunk-pulumi/azure-providers/AzBase/KeyVaultBase';
import _ from 'lodash';
import { KeyVaultKey } from '@azure/keyvault-keys';
import { KeyVaultCertificateWithPolicy } from '@azure/keyvault-certificates';
import { KeyVaultSecret } from '@azure/keyvault-secrets';
import { ResourceType } from '../types';

export function getSecretName(name: string) {
  const sanitizedStack = _.escapeRegExp(stackInfo.stack);
  const n = name.replace(new RegExp(sanitizedStack, 'g'), ''); // Replace occurrences of "stack" variable with "-"

  return rsHelpers.getNameNormalized(n);
}

export type GetVaultItemArgs = { name: string; version?: string; vaultInfo: ResourceType };
export type GetVaultItemArgsInputs = pulumi.Input<GetVaultItemArgs>;

export const getKey = ({ name, version, vaultInfo }: GetVaultItemArgs): Promise<KeyVaultKey | undefined> =>
  getKeyVaultBase(vaultInfo.resourceName).getKey(name, version);

export const getKeyOutput = (args: GetVaultItemArgsInputs) => pulumi.output(args).apply(getKey);

export const getCert = ({ name, vaultInfo }: GetVaultItemArgs): Promise<KeyVaultCertificateWithPolicy | undefined> =>
  getKeyVaultBase(vaultInfo.resourceName).getCert(name);

export const getCertOutput = (args: GetVaultItemArgsInputs) => pulumi.output(args).apply(getCert);

export const getSecret = ({ name, version, vaultInfo }: GetVaultItemArgs): Promise<KeyVaultSecret | undefined> =>
  getKeyVaultBase(vaultInfo.resourceName).getSecret(name, version);

export const getSecretOutput = (args: GetVaultItemArgsInputs) => pulumi.output(args).apply(getSecret);

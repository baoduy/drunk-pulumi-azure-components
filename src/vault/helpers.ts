import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';

import { rsHelpers, stackInfo } from '../helpers';

import { KeyVaultCertificateWithPolicy } from '@azure/keyvault-certificates';
import { KeyVaultKey } from '@azure/keyvault-keys';
import { KeyVaultSecret } from '@azure/keyvault-secrets';
import _ from 'lodash';
import getKeyVaultBase from '@drunk-pulumi/azure-providers/AzBase/KeyVaultBase';

export function getSecretName(name: string) {
  const sanitizedStack = _.escapeRegExp(stackInfo.stack);
  const n = name.replace(new RegExp(sanitizedStack, 'g'), ''); // Replace occurrences of "stack" variable with "-"

  return rsHelpers.getNameNormalized(n);
}

export type GetVaultItemArgs = { name: string; version?: string; vaultInfo: types.ResourceType };
export type GetVaultItemArgsInputs = types.AsInput<GetVaultItemArgs>;

export const getKey = ({ name, version, vaultInfo }: GetVaultItemArgs): Promise<KeyVaultKey | undefined> =>
  getKeyVaultBase(vaultInfo.resourceName).getKey(name, version);

export const getKeyOutput = (args: GetVaultItemArgsInputs) => pulumi.output(args).apply(getKey);

export const getCert = ({ name, vaultInfo }: GetVaultItemArgs): Promise<KeyVaultCertificateWithPolicy | undefined> =>
  getKeyVaultBase(vaultInfo.resourceName).getCert(name);

export const getCertOutput = (args: GetVaultItemArgsInputs) => pulumi.output(args).apply(getCert);

export const getSecret = ({ name, version, vaultInfo }: GetVaultItemArgs): Promise<KeyVaultSecret | undefined> =>
  getKeyVaultBase(vaultInfo.resourceName).getSecret(name, version);

export const getSecretOutput = (args: GetVaultItemArgsInputs) => pulumi.output(args).apply(getSecret);

export const getVaultId = ({
  name,
  version,
  vaultInfo,
  type,
}: types.AsInput<GetVaultItemArgs> & { type: 'secrets' | 'keys' | 'certificates' }) => {
  const vaultUrl = pulumi.interpolate`https://${vaultInfo.resourceName}.vault.azure.net`;
  return version
    ? pulumi.interpolate`${vaultUrl}/${type}/${name}/${version}`
    : pulumi.interpolate`${vaultUrl}/${type}/${name}`;
};

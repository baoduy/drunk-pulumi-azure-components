import * as fs from 'fs/promises';
import { ResourceType, ResourceInputs } from '../types';
import { vaultHelpers } from '../vault';
import * as pulumi from '@pulumi/pulumi';

export type CertFile = {
  certificatePath: string;
  certificatePassword?: string;
};

export type CertType = {
  encodedCertificate: string;
  certificatePassword?: string;
};

export type VaultCertType = {
  vaultCertName: string;
  version?: string;
};

export const getCertFromFile = async (cert: CertFile): Promise<CertType> => {
  const base64Data = await fs.readFile(cert.certificatePath).then((f: Buffer) => f.toString('base64'));
  return {
    encodedCertificate: base64Data,
    certificatePassword: cert.certificatePassword,
  };
};

export const getCertFromVault = async (cert: VaultCertType, vaultInfo: ResourceType): Promise<CertType> => {
  const v = await vaultHelpers.getSecret({ name: cert.vaultCertName, version: cert.version, vaultInfo });

  return {
    encodedCertificate: v?.value!,
    certificatePassword: undefined,
  };
};

export const getCert = async (
  cert: CertType | VaultCertType | CertFile,
  vaultInfo?: ResourceType,
): Promise<CertType> => {
  if ('encodedCertificate' in cert) {
    return cert;
  } else if ('vaultCertName' in cert) {
    if (!vaultInfo) throw new Error('vaultInfo is required for VaultCertType');
    return await getCertFromVault(cert, vaultInfo);
  } else if ('certificatePath' in cert) {
    return await getCertFromFile(cert);
  } else {
    throw new Error('Invalid certificate type');
  }
};

export const getCertOutputs = (cert: CertType | VaultCertType | CertFile, vaultInfo?: ResourceInputs) =>
  pulumi.output(vaultInfo).apply((v) => getCert(cert, v));

export const getCerts = async (
  certs: Array<CertType | VaultCertType | CertFile>,
  vaultInfo: ResourceType,
): Promise<CertType[]> => {
  const results: CertType[] = [];
  for (const cert of certs) {
    results.push(await getCert(cert, vaultInfo));
  }
  return results;
};

export const getCertsOutput = async (certs: Array<CertType | VaultCertType | CertFile>, vaultInfo: ResourceType) =>
  pulumi.output(getCerts(certs, vaultInfo));

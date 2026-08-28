/**
 * @module computeHelper
 * @description Helper module for secure/resilient compute defaults (VM size, OS image, trusted launch)
 */

import * as inputs from '@pulumi/azure-native/types/input';

/** Default Arm64 VM size used when the engineer supplies none */
export const DEFAULT_ARM_VM_SIZE = 'Standard_D4ps_v6';
/** Default x64 VM size used when the engineer supplies none */
export const DEFAULT_X64_VM_SIZE = 'Standard_D4as_v6';

/**
 * Detects whether a VM size belongs to an Arm64 series.
 * Azure Arm sizes carry a `p` in the series suffix (e.g. `D4ps_v6`, `D4pls_v6`).
 * Undefined size defaults to `true` (package favors Arm compute by default).
 */
export function isArmSize(size?: string): boolean {
  if (!size) return true;
  const match = size.match(/^Standard_[A-Z]+\d+([a-z]*)_v\d+/i);
  return match?.[1]?.toLowerCase().includes('p') ?? false;
}

/** Default Linux image: Ubuntu 24.04 LTS gen2, arm64 or x64 sku depending on the resolved size */
export function getDefaultLinuxImage(size?: string): inputs.compute.ImageReferenceArgs {
  return {
    publisher: 'canonical',
    offer: 'ubuntu-24_04-lts',
    sku: isArmSize(size) ? 'server-arm64' : 'server',
    version: 'latest',
  };
}

/** Default Windows image: Windows 11 24H2 Pro */
export function getDefaultWindowsImage(): inputs.compute.ImageReferenceArgs {
  return {
    publisher: 'microsoftwindowsdesktop',
    offer: 'windows-11',
    sku: 'win11-24h2-pro',
    version: 'latest',
  };
}

/** Trusted launch security-profile fragment: secure boot + vTPM */
export const DEFAULT_TRUSTED_LAUNCH: Pick<inputs.compute.SecurityProfileArgs, 'securityType' | 'uefiSettings'> = {
  securityType: 'TrustedLaunch',
  uefiSettings: { secureBootEnabled: true, vTpmEnabled: true },
};

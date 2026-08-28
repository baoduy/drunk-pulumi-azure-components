import {
  DEFAULT_ARM_VM_SIZE,
  DEFAULT_X64_VM_SIZE,
  DEFAULT_TRUSTED_LAUNCH,
  isArmSize,
  getDefaultLinuxImage,
  getDefaultWindowsImage,
} from '../../src/helpers/computeHelper';

// DRK-770 §3.2/§3.3: compute-size and OS-image defaults per architecture.
describe('computeHelper', () => {
  describe('constants', () => {
    test('DEFAULT_ARM_VM_SIZE is the Arm-based standard size', () => {
      expect(DEFAULT_ARM_VM_SIZE).toBe('Standard_D4ps_v6');
    });

    test('DEFAULT_X64_VM_SIZE is the x64 standard size', () => {
      expect(DEFAULT_X64_VM_SIZE).toBe('Standard_D4as_v6');
    });

    test('DEFAULT_TRUSTED_LAUNCH enables secure boot and vTPM', () => {
      expect(DEFAULT_TRUSTED_LAUNCH).toEqual({
        securityType: 'TrustedLaunch',
        uefiSettings: { secureBootEnabled: true, vTpmEnabled: true },
      });
    });
  });

  describe('isArmSize', () => {
    test('undefined size defaults to Arm (package favors Arm compute by default)', () => {
      expect(isArmSize(undefined)).toBe(true);
    });

    test('a size carrying the Arm "p" series marker is Arm', () => {
      expect(isArmSize('Standard_D4ps_v6')).toBe(true);
    });

    test('a size with no "p" series marker is x64', () => {
      expect(isArmSize('Standard_D4as_v6')).toBe(false);
    });

    test('a plain non-Arm size with no series suffix letters is x64', () => {
      expect(isArmSize('Standard_D2s_v3')).toBe(false);
    });

    test('an unrecognized size string degrades to x64 rather than throwing', () => {
      expect(isArmSize('not-a-vm-size')).toBe(false);
    });
  });

  describe('getDefaultLinuxImage', () => {
    test('no size resolves the Arm64 Ubuntu sku (bare VM defaults to Arm)', () => {
      expect(getDefaultLinuxImage(undefined)).toEqual({
        publisher: 'canonical',
        offer: 'ubuntu-24_04-lts',
        sku: 'server-arm64',
        version: 'latest',
      });
    });

    test('an Arm size resolves the Arm64 Ubuntu sku', () => {
      expect(getDefaultLinuxImage('Standard_D4ps_v6').sku).toBe('server-arm64');
    });

    // Thin spot called out by the spec-review gate: the x64 branch must not ride on the Arm case.
    test('an x64 size (Standard_D4as_v6) resolves the x64 Ubuntu sku, not Arm64', () => {
      expect(getDefaultLinuxImage('Standard_D4as_v6')).toEqual({
        publisher: 'canonical',
        offer: 'ubuntu-24_04-lts',
        sku: 'server',
        version: 'latest',
      });
    });
  });

  describe('getDefaultWindowsImage', () => {
    test('resolves Windows 11 24H2 Pro', () => {
      expect(getDefaultWindowsImage()).toEqual({
        publisher: 'microsoftwindowsdesktop',
        offer: 'windows-11',
        sku: 'win11-24h2-pro',
        version: 'latest',
      });
    });
  });
});

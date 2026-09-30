import * as pulumi from '@pulumi/pulumi';
import { aksClusterFactory, Captured, useAksMocks } from '../testUtils/pulumiMocks';

// DRK-1821 row 3 / rule R1: a caller-supplied `autoUpgradeProfile` (on the public Args `Pick`) reaches
// the ManagedCluster verbatim; with none supplied the component default { NodeImage, stable } applies.

let captured: Captured[];
useAksMocks(pulumi, () => captured);

import { AzKubernetes } from '../../src/aks/AzKubernetes';

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  sku: { name: 'Base' },
  features: { enablePrivateCluster: false },
  agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
};

const createCluster = aksClusterFactory(pulumi, AzKubernetes, baseArgs, () => captured);

describe('AzKubernetes — caller-supplied autoUpgradeProfile (DRK-1821 R1)', () => {
  beforeEach(() => {
    captured = [];
  });

  test('S1 — a caller autoUpgradeProfile reaches the cluster verbatim', async () => {
    const cluster = await createCluster({
      autoUpgradeProfile: { upgradeChannel: 'none', nodeOSUpgradeChannel: 'None' },
    });
    expect(cluster).toBeDefined();
    expect(cluster.inputs.autoUpgradeProfile).toEqual({ upgradeChannel: 'none', nodeOSUpgradeChannel: 'None' });
  });

  test('S2 — no autoUpgradeProfile keeps the NodeImage / stable default', async () => {
    const cluster = await createCluster({});
    expect(cluster).toBeDefined();
    expect(cluster.inputs.autoUpgradeProfile).toEqual({ nodeOSUpgradeChannel: 'NodeImage', upgradeChannel: 'stable' });
  });
});

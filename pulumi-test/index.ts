import * as pulumi from '@pulumi/pulumi';
import { PGPGenerator } from '@drunk-pulumi/azure-components';

const rs = (async () => {
  var pgpKey = new PGPGenerator('pgp-test', {
    user: { name: 'test', email: 'test@drunk.dev' },
    passphrase: 'test',
    validDays: 365,
  });

  return {
    publicKey: pgpKey.publicKey,
    privateKey: pgpKey.privateKey,
    revocationCertificate: pgpKey.revocationCertificate,
  };
})();

export default pulumi.output(rs);

import * as netmask from 'netmask';

export function getIpsRange(prefix: string) {
  return new netmask.Netmask(prefix);
}

/** Convert IP address and IP address group into range */
export function convertToIpRange(ipAddress: string[]): Array<{ start: string; end: string }> {
  return ipAddress.flatMap((ip) => {
    if (ip.includes('/')) {
      const range = getIpsRange(ip);
      return { start: range.base!, end: range.broadcast! };
    }
    return [{ start: ip!, end: ip! }];
  });
}

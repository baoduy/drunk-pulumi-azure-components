import * as netmask from 'netmask';

export const getIpsRange = (prefix: string) => new netmask.Netmask(prefix);

/** Convert IP address and IP address group into range */
export const convertToIpRange = (ipAddress: string[]): Array<{ start: string; end: string }> =>
  ipAddress.map((ip) => {
    if (ip.includes('/')) {
      const range = getIpsRange(ip);
      return { start: range.base, end: range.broadcast };
    }
    return { start: ip, end: ip };
  });

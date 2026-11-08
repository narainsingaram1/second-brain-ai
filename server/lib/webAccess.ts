import { isPrivateAddress, type WebAccess } from "../../src/services/webTools";

type Dns = { lookup(host: string, options: { all: true }): Promise<Array<{ address: string }>> };
const DNS_MODULE = "node:dns/promises";
/** Every address a name resolves to, using the server runtime's resolver. */
async function systemLookup(host: string): Promise<string[]> {
  const dns = await import(/* @vite-ignore */ DNS_MODULE) as Dns;
  return (await dns.lookup(host, { all: true })).map(a => a.address);
}

/**
 * Network access for read_url on the server: every hop is resolved first, and a name that points at a
 * private or loopback address is refused, so a link can't be used to reach internal services.
 */
export function serverWebAccess(fetchImpl: typeof fetch = (...args) => fetch(...args),
  lookup: (host: string) => Promise<string[]> = systemLookup): WebAccess {
  return {
    fetch: fetchImpl,
    manualRedirects: true,
    async checkHost(hostname) {
      let addresses: string[];
      try { addresses = await lookup(hostname.replace(/^\[|\]$/g, "")); } catch { throw new Error("That website's address couldn't be found."); }
      if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("Links to this computer or a private network can't be opened.");
    },
  };
}

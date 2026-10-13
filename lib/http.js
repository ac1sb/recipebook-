// Runs both on Node (your computer) and on Cloudflare Workers.
const onWorkers = globalThis.navigator?.userAgent === 'Cloudflare-Workers';

const isIPv4 = (s) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(s);
const isIPv6 = (s) => s.includes(':') && /^[0-9a-f:.]+$/i.test(s);

// An honest bot UA gets through more recipe sites' bot filters than a spoofed browser one.
export const UA = 'BorsariKitchen/1.0 (personal recipe library; +https://github.com/ac1sb/recipebook-)';
export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export async function fetchWithTimeout(url, { timeout = 10000, headers = {}, ...opts } = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  return res;
}

export async function fetchJson(url, opts) {
  const res = await fetchWithTimeout(url, { ...opts, headers: { Accept: 'application/json', ...(opts?.headers || {}) } });
  if (!res.ok) {
    const err = new Error(`${new URL(url).hostname} responded ${res.status}`);
    err.status = 502;
    err.upstreamStatus = res.status;
    throw err;
  }
  return res.json();
}

function isPrivateIp(ip) {
  if (isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

// Only allow fetching public http(s) pages when importing user-supplied URLs.
export async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error('That does not look like a valid URL.'), { status: 400 });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('Only http(s) links can be imported.'), { status: 400 });
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw Object.assign(new Error('That address is not allowed.'), { status: 400 });
  }
  let addrs;
  if (isIPv4(host) || isIPv6(host)) addrs = [{ address: host }];
  else if (onWorkers) return url; // Workers can't reach private networks, and has no DNS lookup to check with.
  else {
    const dns = await import('node:dns/promises');
    addrs = await dns.lookup(host, { all: true }).catch(() => []);
  }
  if (!addrs.length) throw Object.assign(new Error(`Could not find ${host}.`), { status: 400 });
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw Object.assign(new Error('That address is not allowed.'), { status: 400 });
  }
  return url;
}

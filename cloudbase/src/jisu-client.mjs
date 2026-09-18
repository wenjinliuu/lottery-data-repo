const QUERY_URL = "https://api.jisuapi.com/caipiao/query";
const CLASS_URL = "https://api.jisuapi.com/caipiao/class";

async function fetchJson(url, timeoutMs = 15000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`upstream_http_${response.status}`);
  return response.json();
}

export class JisuClient {
  constructor(appkey, timeoutMs = 15000) {
    if (!appkey) throw new Error("Missing JISU_APPKEY");
    this.appkey = appkey;
    this.timeoutMs = timeoutMs;
  }

  query(caipiaoid) {
    const url = new URL(QUERY_URL);
    url.searchParams.set("appkey", this.appkey);
    url.searchParams.set("caipiaoid", String(caipiaoid));
    return fetchJson(url, this.timeoutMs);
  }

  getClass() {
    const url = new URL(CLASS_URL);
    url.searchParams.set("appkey", this.appkey);
    return fetchJson(url, this.timeoutMs);
  }
}

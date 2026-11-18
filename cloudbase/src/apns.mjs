import { createPrivateKey, sign } from "node:crypto";
import http2 from "node:http2";

const HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

const base64url = (value) => Buffer.from(value).toString("base64url");

/** 环境变量里的 .p8：可以是原文、`\n` 写成两个字符的原文，或整份文件的 base64。 */
export function readSigningKey(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const pem = text.includes("BEGIN PRIVATE KEY")
    ? text.replace(/\\n/g, "\n")
    : Buffer.from(text, "base64").toString("utf8");
  return createPrivateKey(pem);
}

export function providerToken({ key, keyId, teamId, now = Date.now() }) {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) }));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${base64url(signature)}`;
}

function post(session, path, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = session.request({ ":method": "POST", ":path": path, ...headers });
    let status = 0;
    let text = "";
    const timer = setTimeout(() => {
      reject(new Error("apns timeout"));
      request.close(http2.constants.NGHTTP2_CANCEL);
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timer);
      reject(new Error("apns request closed before completion"));
    };
    request.once("close", onClose);
    request.on("response", (responseHeaders) => { status = Number(responseHeaders[":status"]); });
    request.setEncoding("utf8");
    request.on("data", (chunk) => { text += chunk; });
    request.on("end", () => {
      clearTimeout(timer);
      resolve({ status, body: text });
    });
    request.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end(body);
  });
}

/** 没配推送密钥时返回 null —— 核对照常进行，只是不推。 */
export function createApnsClient({
  keyP8 = process.env.APNS_KEY_P8,
  keyId = process.env.APNS_KEY_ID,
  teamId = process.env.APNS_TEAM_ID,
  topic = process.env.APNS_TOPIC,
  timeoutMs = 10000,
  connect = http2.connect,
} = {}) {
  if (!keyP8 || !keyId || !teamId || !topic) return null;
  let key;
  try {
    key = readSigningKey(keyP8);
  } catch (error) {
    // 密钥配坏了也不能挡住核对：当成没配，只留一条日志（不打印密钥内容）。
    console.error("apns signing key unreadable", error?.code ?? error?.name ?? "error");
    return null;
  }
  if (!key) return null;
  return {
    /**
     * @returns {Promise<Array<{token, ok, status, reason, gone}>>} gone 表示令牌已失效，应停用。
     */
    async send(devices, { title, body, data = {}, threadId, contentAvailable = false, collapseId }) {
      const payload = JSON.stringify({
        aps: {
          alert: { title, body },
          sound: "default",
          ...(threadId ? { "thread-id": threadId } : {}),
          // 有机会在后台核对；不依赖唤醒来显示原始通知。
          ...(contentAvailable ? { "content-available": 1 } : {}),
        },
        ...data,
      });
      const token = providerToken({ key, keyId: keyId.trim(), teamId: teamId.trim() });
      const byHost = new Map();
      for (const device of devices) {
        const host = HOSTS[device.environment] ?? HOSTS.production;
        if (!byHost.has(host)) byHost.set(host, []);
        byHost.get(host).push(device);
      }

      const sendGroup = async ([host, group]) => {
        const deadline = Date.now() + timeoutMs;
        const session = connect(host);
        session.on("error", () => {});
        const results = [];
        try {
          for (let offset = 0; offset < group.length; offset += 25) {
            const batch = group.slice(offset, offset + 25);
            const remaining = deadline - Date.now();
            const received = await Promise.all(batch.map(async (device) => {
              const failure = { token: device.token, ok: false, status: 0, reason: "network_error", gone: false };
              if (remaining <= 0) return failure;
              try {
                const response = await post(session, `/3/device/${device.token}`, {
                  authorization: `bearer ${token}`,
                  // All registrations belong to the one configured app.
                  "apns-topic": topic.trim(),
                  "apns-push-type": "alert",
                  "apns-priority": "10",
                  "apns-expiration": String(Math.floor(Date.now() / 1000) + 4 * 60 * 60),
                  ...(collapseId ? { "apns-collapse-id": collapseId } : {}),
                  "content-type": "application/json",
                }, payload, remaining);
                let reason = "";
                try {
                  const value = JSON.parse(response.body || "{}").reason;
                  if (typeof value === "string" && /^[A-Z][a-zA-Z]{0,49}$/.test(value)) reason = value;
                } catch { /* APNs may close without a JSON body */ }
                return {
                  token: device.token,
                  ok: response.status === 200,
                  status: response.status,
                  reason,
                  gone: response.status === 410 || ["BadDeviceToken", "Unregistered"].includes(reason),
                };
              } catch {
                // A transport error can contain the request path and the device token.
                return failure;
              }
            }));
            results.push(...received);
          }
        } finally {
          session.close();
        }
        return results;
      };

      return (await Promise.all([...byHost].map(sendGroup))).flat();
    },
  };
}

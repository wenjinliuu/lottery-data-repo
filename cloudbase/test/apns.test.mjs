import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { generateKeyPairSync, verify } from "node:crypto";
import { createApnsClient, providerToken, readSigningKey } from "../src/apns.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });

test("签名密钥接受原文、转义换行和 base64 三种写法", () => {
  for (const raw of [pem, pem.replace(/\n/g, "\\n"), Buffer.from(pem).toString("base64")]) {
    assert.equal(readSigningKey(raw).asymmetricKeyType, "ec");
  }
  assert.equal(readSigningKey(""), null);
});

test("令牌是 ES256 JWT，验得过签名", () => {
  const token = providerToken({ key: readSigningKey(pem), keyId: "KEY123", teamId: "TEAM456", now: 1_700_000_000_000 });
  const [header, claims, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "ES256", kid: "KEY123" });
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url")), { iss: "TEAM456", iat: 1_700_000_000 });
  assert.equal(verify("sha256", Buffer.from(`${header}.${claims}`),
    { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")), true);
});

test("缺任何一项配置就不创建客户端", () => {
  assert.equal(createApnsClient({ keyP8: pem, keyId: "K", teamId: "T", topic: "" }), null);
  assert.equal(createApnsClient({ keyP8: "", keyId: "K", teamId: "T", topic: "x" }), null);
  // 部署模板没替换、或密钥贴坏了：当成没配，不抛异常
  assert.equal(createApnsClient({ keyP8: "{{env.APNS_KEY_P8}}", keyId: "K", teamId: "T", topic: "x" }), null);
});

test("按环境分主机发送，410 标成失效", async () => {
  const requests = [];
  const connect = (host) => {
    const session = new EventEmitter();
    session.close = () => {};
    session.request = (headers) => {
      const stream = new EventEmitter();
      stream.setTimeout = () => {};
      stream.setEncoding = () => {};
      stream.end = (body) => {
        requests.push({ host, headers, body: JSON.parse(body) });
        const dead = headers[":path"].endsWith("dead");
        queueMicrotask(() => {
          stream.emit("response", { ":status": dead ? 410 : 200 });
          if (dead) stream.emit("data", JSON.stringify({ reason: "Unregistered" }));
          stream.emit("end");
        });
      };
      return stream;
    };
    return session;
  };
  const client = createApnsClient({ keyP8: pem, keyId: "K", teamId: "T", topic: "app.bundle", connect });
  const results = await client.send([
    { token: "good", environment: "production", bundle_id: "" },
    { token: "dead", environment: "sandbox", bundle_id: "other.bundle" },
  ], { title: "t", body: "b", data: { issue: "1" }, threadId: "draw-ssq", mutableContent: true, contentAvailable: true, collapseId: "draw-ssq-1" });
  assert.deepEqual(results.map((r) => [r.token, r.ok, r.gone]), [["good", true, false], ["dead", false, true]]);
  assert.deepEqual(requests.map((r) => [r.host, r.headers["apns-topic"]]), [
    ["https://api.push.apple.com", "app.bundle"],
    ["https://api.sandbox.push.apple.com", "other.bundle"],
  ]);
  assert.deepEqual(requests[0].body, { aps: { alert: { title: "t", body: "b" }, sound: "default", "thread-id": "draw-ssq", "mutable-content": 1, "content-available": 1 }, issue: "1" });
  assert.equal(requests[0].headers["apns-collapse-id"], "draw-ssq-1");
});

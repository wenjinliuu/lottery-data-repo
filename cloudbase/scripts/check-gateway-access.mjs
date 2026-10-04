import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function verifyGateway(payload, expected) {
  const domains = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.Domain === expected.domain && Array.isArray(value.Routes)) domains.push(value);
    for (const child of Object.values(value)) visit(child);
  };
  visit(payload);
  const route = domains.flatMap((domain) => domain.Routes).find((item) => item.Path === "/lottery");
  assert.ok(route, "Lottery route must exist");
  assert.equal(route.UpstreamResourceName, "lottery-api-http");
  assert.equal(route.QPSPolicy?.QPSTotal, 100);
  assert.equal(route.QPSPolicy?.QPSPerClient?.LimitBy, "ClientIP");
  assert.equal(route.QPSPolicy?.QPSPerClient?.LimitValue, 10);
}

if (process.argv[1]?.endsWith("check-gateway-access.mjs")) {
  verifyGateway(JSON.parse(readFileSync(process.argv[2], "utf8")),
    JSON.parse(readFileSync("config/lottery-gateway-access.json", "utf8")));
  console.log("Lottery gateway verified: 100 QPS total, 10 QPS per client IP.");
}

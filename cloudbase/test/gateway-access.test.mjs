import test from "node:test";
import assert from "node:assert/strict";
import { verifyGateway } from "../scripts/check-gateway-access.mjs";

test("gateway verifier rejects absent/mismatched limits instead of reporting a successful deployment", () => {
  const expected = { domain: "cloud.example" };
  const route = {
    Path: "/lottery", UpstreamResourceName: "lottery-api-http",
    QPSPolicy: { QPSTotal: 100, QPSPerClient: { LimitBy: "ClientIP", LimitValue: 10 } },
  };
  const payload = (item) => ({ data: { Domains: [{ Domain: expected.domain, Routes: [item] }] } });
  assert.doesNotThrow(() => verifyGateway(payload(route), expected));
  assert.throws(() => verifyGateway(payload({ ...route, QPSPolicy: {} }), expected));
  assert.throws(() => verifyGateway(payload({ ...route, Path: "/holidays/v1" }), expected));
});

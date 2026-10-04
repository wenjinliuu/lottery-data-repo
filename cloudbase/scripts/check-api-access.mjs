import assert from "node:assert/strict";

const base = process.env.LOTTERY_API_URL;
const key = process.env.LOTTERY_READ_API_KEY?.trim();
assert.ok(base && key, "Configure the lottery URL and App read key before the smoke test");

async function request(path, headers = {}) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(20_000) });
      const body = await response.json();
      if (response.status === 503 && attempt < 5) throw new Error("Function is warming up");
      return { response, body };
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

for (const headers of [{}, { "X-Lottery-Api-Key": "incorrect-read-key" }]) {
  const { response, body } = await request("/v2/bootstrap", headers);
  assert.equal(response.status, 401);
  assert.equal(body.error, "unauthorized");
  // The gateway may append stricter cache directives to 401 responses.
  assert.ok(response.headers.get("cache-control")?.split(",")
    .some((directive) => directive.trim().toLowerCase() === "no-store"),
    "Unauthorized responses must retain the no-store directive");
}
const headers = { "X-Lottery-Api-Key": key };
for (const path of ["/v2/health", "/v2/status", "/v2/bootstrap"]) {
  const { response, body } = await request(path, headers);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get("cache-control"), /^private,/);
  if (path === "/v2/health") assert.equal(body.ok, true);
  if (path === "/v2/status") assert.equal(body.schema, "duigehao.lottery.status");
  if (path === "/v2/bootstrap") assert.equal(Object.keys(body.latest).length, 8);
}
console.log("Access checks passed: missing/wrong key rejected, health/status/bootstrap readable with the App key.");

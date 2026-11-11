import http from "node:http";
import { handleHttp } from "./api-handler.mjs";

const MAX_BODY_BYTES = 16 * 1024;

// 只有登记推送设备会带请求体；超过 16KB 直接断开，不往内存里攒。
function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function requestEvent(req) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  return {
    httpMethod: req.method || "GET",
    path: url.pathname,
    rawPath: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    headers: req.headers,
    body: await readBody(req),
  };
}

function writeResult(req, res, result) {
  res.writeHead(result.statusCode ?? 500, result.headers ?? {});
  if (req.method === "HEAD" || !result.body) {
    res.end();
    return;
  }
  res.end(result.body);
}

export function createLotteryHttpServer(service, checkAccess, pushStore) {
  return http.createServer(async (req, res) => {
    try {
      writeResult(req, res, await handleHttp(await requestEvent(req), service, checkAccess, pushStore));
    } catch (error) {
      console.error("lottery-api-http request failed", String(error));
      res.writeHead(500, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
      });
      res.end(JSON.stringify({ error: "internal_error" }));
    }
  });
}

export function startLotteryHttpServer({
  host = "0.0.0.0",
  port = Number(process.env.PORT || 9000),
} = {}) {
  const server = createLotteryHttpServer();
  server.listen(port, host, () => {
    console.log(`lottery-api-http listening on ${host}:${port}`);
  });
  return server;
}

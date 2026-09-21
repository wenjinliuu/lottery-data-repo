import http from "node:http";
import { handleHttp } from "./api-handler.mjs";

function requestEvent(req) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  return {
    httpMethod: req.method || "GET",
    path: url.pathname,
    rawPath: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
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

export function createLotteryHttpServer(service) {
  return http.createServer(async (req, res) => {
    try {
      writeResult(req, res, await handleHttp(requestEvent(req), service));
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

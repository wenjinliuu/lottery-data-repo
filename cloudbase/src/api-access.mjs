import { createHash, timingSafeEqual } from "node:crypto";

export const API_KEY_HEADER = "x-lottery-api-key";

function digest(value) {
  return createHash("sha256").update(value).digest();
}

// This is an application read key, never a CloudBase management credential.
// Fail closed if deployment omitted it. Do not accept keys in URLs or log them.
export function createApiAccess({ apiKey = process.env.LOTTERY_READ_API_KEY } = {}) {
  const configured = typeof apiKey === "string" && apiKey.length >= 32;
  const expected = configured ? digest(apiKey) : null;
  return (event) => {
    if (!expected) return { statusCode: 503, error: "api_access_not_configured" };
    const matches = Object.entries(event.headers ?? {})
      .filter(([name]) => name.toLowerCase() === API_KEY_HEADER);
    if (matches.length !== 1) return { statusCode: 401, error: "unauthorized" };
    const value = matches[0][1];
    if (typeof value !== "string" || value.length > 256 || !timingSafeEqual(digest(value), expected)) {
      return { statusCode: 401, error: "unauthorized" };
    }
    return null;
  };
}

export const apiAccess = createApiAccess();

import { createHash, timingSafeEqual } from "node:crypto";

export const USER_KEY_HEADER = "x-lottery-user-key";

const digest = (value) => createHash("sha256").update(value).digest();

// 个人密钥：读写自己的票据。和开奖读取密钥分开——那一把编进安装包、可被提取，
// 这一把只存在手机钥匙串里。部署漏配时一律拒绝，不放行。
export function createUserAccess({ userKey = process.env.LOTTERY_USER_API_KEY } = {}) {
  const normalized = typeof userKey === "string" ? userKey.trim() : "";
  const expected = /^[A-Za-z0-9_-]{32,128}$/.test(normalized) ? digest(normalized) : null;
  return (event) => {
    if (!expected) return { statusCode: 503, error: "user_access_not_configured" };
    const matches = Object.entries(event.headers ?? {})
      .filter(([name]) => name.toLowerCase() === USER_KEY_HEADER);
    if (matches.length !== 1) return { statusCode: 401, error: "unauthorized" };
    const value = matches[0][1];
    if (typeof value !== "string" || value.length > 256
      || !timingSafeEqual(digest(value.trim()), expected)) {
      return { statusCode: 401, error: "unauthorized" };
    }
    return null;
  };
}

export const userAccess = createUserAccess();

import { createApiAccess, API_KEY_HEADER } from "../src/api-access.mjs";

export const TEST_API_KEY = "unit-test-only-read-key-not-for-production";
export const authenticatedEvent = (event) => ({
  ...event,
  headers: { [API_KEY_HEADER]: TEST_API_KEY, ...event.headers },
});
export const testAccess = createApiAccess({ apiKey: TEST_API_KEY });

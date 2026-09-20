import { runIngest } from "../src/handler.mjs";

const result = await runIngest({
  slot: "github_fallback",
  runner: "github-fallback",
});

console.log(JSON.stringify(result, null, 2));


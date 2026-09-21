import("./src/http-server.mjs")
  .then(({ startLotteryHttpServer }) => startLotteryHttpServer())
  .catch((error) => {
    console.error("lottery-api-http startup failed", String(error));
    process.exitCode = 1;
  });

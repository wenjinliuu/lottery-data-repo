exports.main = async (event = {}) => {
  const { main } = await import("../src/handler.mjs");
  return main(event);
};

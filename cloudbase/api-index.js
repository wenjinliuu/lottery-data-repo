exports.main = async (event = {}, context = {}) => {
  const { main } = await import("./src/api-handler.mjs");
  return main(event, context);
};

exports.main = async (event = {}) => {
  if (event.action === "import_history") {
    const { importHistory } = await import("./scripts/import-history.mjs");
    return importHistory();
  }

  const { main } = await import("./src/handler.mjs");
  return main(event);
};

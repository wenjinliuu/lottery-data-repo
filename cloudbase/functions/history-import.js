exports.main = async () => {
  const { importHistory } = await import("../scripts/import-history.mjs");
  return importHistory();
};

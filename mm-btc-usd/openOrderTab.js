const { loadMMConfig, openOrderTab } = require("../helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);

  let marketId = "11";

  await openOrderTab(marketId, config);
}

main();

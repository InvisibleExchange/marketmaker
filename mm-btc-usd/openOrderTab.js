const { loadMMConfig, openOrderTab } = require("../helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);

  let marketId = "11";

  await openOrderTab(marketId, config);
}

main();

// base_amount: 8000000000,
// amount_spent:2000000000,

// quote_amount: 150000000000
// amount_receiv 58275835988,

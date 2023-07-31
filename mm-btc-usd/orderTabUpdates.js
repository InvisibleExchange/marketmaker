const {
  loadMMConfig,
  openOrderTab,
  modifyOrderTab,
  closeOrderTab,
} = require("../helpers");

const path = require("path");

async function runOpenOrderTab() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);

  let marketId = "11";

  await openOrderTab(marketId, config);
}

async function runCloseOrderTab() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);

  let marketId = "11";

  await closeOrderTab(marketId, config);
}

async function runModifiyOrderTab() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);

  let marketId = "11";

  await modifyOrderTab(marketId, config);
}

runOpenOrderTab();
// runCloseOrderTab();
// runModifiyOrderTab();

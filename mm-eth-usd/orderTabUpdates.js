const {
  loadMMConfig,
  openOrderTab,
  modifyOrderTab,
  closeOrderTab,
} = require("../src/helpers");

const path = require("path");

async function runOpenOrderTab() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath).MM_CONFIG.privKey;

  let marketId = "12";

  await openOrderTab(marketId, config);
}

async function runCloseOrderTab() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath).MM_CONFIG.privKey;

  let marketId = "12";

  await closeOrderTab(marketId, config);
}

async function runModifiyOrderTab() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath).MM_CONFIG.privKey;

  let marketId = "12";

  await modifyOrderTab(marketId, config);
}

runOpenOrderTab();
// runCloseOrderTab();
// runModifiyOrderTab();

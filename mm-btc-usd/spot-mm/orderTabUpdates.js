const {
  loadMMConfig,
  openOrderTab,
  modifyOrderTab,
  closeOrderTab,
} = require("../../src/helpers");

const path = require("path");

async function runOpenOrderTab() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);
  let privKey = config.MM_CONFIG.PRIVATE_KEY;

  let marketId = "11";

  await openOrderTab(marketId, privKey);

  process.exit(0);
}

async function runCloseOrderTab() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);
  let privKey = config.MM_CONFIG.PRIVATE_KEY;

  let marketId = "11";

  await closeOrderTab(marketId, privKey);
}

async function runModifiyOrderTab() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);
  let privKey = config.MM_CONFIG.PRIVATE_KEY;

  let marketId = "11";

  await modifyOrderTab(marketId, privKey);
}

runOpenOrderTab();
// runCloseOrderTab();
// runModifiyOrderTab();

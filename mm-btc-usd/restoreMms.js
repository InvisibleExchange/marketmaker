const { restoreUserState } = require("../src/helpers/keyRetrieval");
const { loadMMConfig } = require("../helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "spot_config.json");
  let spotConfig = loadMMConfig(configPath);

  await restoreUserState(spotConfig.MM_CONFIG.privKey, true, false);

  configPath = path.join(__dirname, "perp_config.json");
  let perpConfig = loadMMConfig(configPath);

  await restoreUserState(perpConfig.MM_CONFIG.privKey, true, true);
}

main();

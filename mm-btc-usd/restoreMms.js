const { restoreUserState } = require("../src/helpers/keyRetrieval");
const { loadMMConfig } = require("../helpers");

const path = require("path");
const User = require("../src/users/Invisibl3User");

async function main() {
  let configPath = path.join(__dirname, "spot_config.json");
  let spotConfig = loadMMConfig(configPath);

  let user = User.fromPrivKey(spotConfig.MM_CONFIG.privKey.toString());
  await user.login();

  await restoreUserState(user, true, false);

  // ? ============= PERP =============

  configPath = path.join(__dirname, "perp_config.json");
  let perpConfig = loadMMConfig(configPath);

  user = User.fromPrivKey(perpConfig.MM_CONFIG.privKey.toString());
  await user.login();

  await restoreUserState(user, true, true);
}

main();

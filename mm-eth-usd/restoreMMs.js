const { UserState } = require("invisible-sdk/src/users");
const { loadMMConfig } = require("../src/helpers");

const path = require("path");
const { restoreUserState } = require("invisible-sdk/src/utils");

async function main() {
  let configPath = path.join(__dirname, "spot_config.json");
  let spotConfig = loadMMConfig(configPath);

  let user = UserState.fromPrivKey(spotConfig.MM_CONFIG.privKey.toString());
  await user.login();

  await restoreUserState(user, true, false);

  // ? ============= PERP =============

  configPath = path.join(__dirname, "perp_config.json");
  let perpConfig = loadMMConfig(configPath);

  user = UserState.fromPrivKey(perpConfig.MM_CONFIG.privKey.toString());
  await user.login();

  await restoreUserState(user, true, true);
}

main();

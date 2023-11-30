const { loadMMConfig } = require("../src/helpers");

const path = require("path");
const { UserState } = require("invisible-sdk/src/users");
const { restoreUserState } = require("invisible-sdk/src/utils");

async function main() {
  // ? ============= PERP =============

  let configPath = path.join(__dirname, "perp_config.json");
  let perpConfig = loadMMConfig(configPath);

  let user = UserState.fromPrivKey(perpConfig.MM_CONFIG.privKey.toString());
  await user.login();

  await restoreUserState(user, true, true);
}

main();

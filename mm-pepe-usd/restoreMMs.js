const { restoreUserState } = require("../src/helpers/keyRetrieval");
const { loadMMConfig } = require("../helpers");

const path = require("path");
const User = require("../src/users/Invisibl3User");

async function main() {
  // ? ============= PERP =============

  let configPath = path.join(__dirname, "perp_config.json");
  let perpConfig = loadMMConfig(configPath);

  let user = User.fromPrivKey(perpConfig.MM_CONFIG.privKey.toString());
  await user.login();

  await restoreUserState(user, true, true);
}

main();

const { UserState } = require("invisible-sdk/src/users");
const { loadMMConfig } = require("../src/helpers");
const { restoreUserState } = require("invisible-sdk/src/utils");

const path = require("path");
const fs = require("fs");

async function main() {
  let configPath = path.join(__dirname, "./spot-mm/spot_config.json");
  let spotConfig = loadMMConfig(configPath);

  let user = UserState.fromPrivKey(spotConfig.MM_CONFIG.PRIVATE_KEY.toString());
  await user.login();

  await restoreUserState(user, true, false);

  // ? ============= PERP =============

  configPath = path.join(__dirname, "./perp-mm/perp_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let perpConfig = JSON.parse(mmConfigFile);

  let privKey = perpConfig.PRIVATE_KEY;

  user = UserState.fromPrivKey(privKey.toString());
  await user.login();

  await restoreUserState(user, true, true);
}

main();

const { UserState } = require("invisible-sdk/src/users");
const { restoreUserState } = require("invisible-sdk/src/utils");

const path = require("path");
const fs = require("fs");

async function main() {
  // ? ============= PERP =============

  let configPath = path.join(__dirname, "perp_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let perpConfig = JSON.parse(mmConfigFile);

  let privKey = perpConfig.PRIVATE_KEY;

  let user = UserState.fromPrivKey(privKey.toString());
  await user.login();

  await restoreUserState(user, true, true);
}

main();

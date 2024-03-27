const { makeDeposits } = require("../../src/helpers");

const path = require("path");
const fs = require("fs");
const { UserState } = require("invisible-sdk/src/users");
const { sendDeposit } = require("invisible-sdk/src/transactions");
const {
  DECIMALS_PER_ASSET,
  SYMBOLS_TO_IDS,
} = require("invisible-sdk/src/utils");
const { executeDepositTx } = require("../../src/onchainInteractions");

async function testDeposit() {
  let configPath = path.join(__dirname, "perp_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let config = JSON.parse(mmConfigFile);

  let privKey = config.PRIVATE_KEY;
  await makeDeposits([2413654107], [100_000], privKey);

  process.exit(0);
}
// testDeposit();

async function makeOnchainDeposit() {
  // * Onchain deposits

  let configPath = path.join(__dirname, "perp_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let config = JSON.parse(mmConfigFile);

  let privKey = config.PRIVATE_KEY;
  let marketMaker = await UserState.loginUser(privKey);

  let token = SYMBOLS_TO_IDS["USDC"];
  let amount = 10_000;

  let deposit = await executeDepositTx(marketMaker, amount, token);

  console.log(deposit);
}

async function claimDeposit() {
  // * Claim deposits

  let configPath = path.join(__dirname, "perp_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let config = JSON.parse(mmConfigFile);

  let privKey = config.PRIVATE_KEY;
  let marketMaker = await UserState.loginUser(privKey);

  for (const deposit of marketMaker.deposits) {
    await sendDeposit(
      marketMaker,
      deposit.deposit_id,
      deposit.deposit_amount / 10 ** DECIMALS_PER_ASSET[deposit.deposit_token],
      deposit.deposit_token,
      deposit.stark_key
    );

    marketMaker.deposits = marketMaker.deposits.filter(
      (d) => d.deposit_id != deposit.deposit_id
    );
  }

  console.log("usdc balance: ", marketMaker.getAvailableAmount(2413654107));
}

// makeOnchainDeposit();
// claimDeposit();

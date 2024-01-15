const { loadMMConfig, makeDeposits } = require("../../src/helpers");

const path = require("path");
const fs = require("fs");
const { UserState } = require("invisible-sdk/src/users");
const { sendDeposit } = require("invisible-sdk/src/transactions");
const { DECIMALS_PER_ASSET } = require("invisible-sdk/src/utils");
const { executeDepositTx } = require("../../src/onchainInteractions");

async function testDeposit() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);
  let privKey = config.MM_CONFIG.PRIVATE_KEY;

  await makeDeposits([2413654107, 3592681469], [150_000, 6], privKey);
}

testDeposit();

async function makeOnchainDeposit() {
  // * Onchain deposits

  let configPath = path.join(__dirname, "spot_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let config = JSON.parse(mmConfigFile);

  let privKey = config.PRIVATE_KEY;
  let marketMaker = await UserState.loginUser(privKey);

  let usdcId = 2413654107;
  let usdcAmount = 10_000;

  let wbtcId = 3592681469;
  let wbtcAmount = 5;

  let deposit = await executeDepositTx(marketMaker, usdcAmount, usdcId);
  console.log(deposit);

  deposit = await executeDepositTx(marketMaker, wbtcAmount, wbtcId);
  console.log(deposit);
}

async function claimDeposit() {
  // * Claim deposits

  let configPath = path.join(__dirname, "spot_config.json");
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
  console.log("wbtc balance: ", marketMaker.getAvailableAmount(3592681469));
}

// makeOnchainDeposit();

// claimDeposit();

const { makeDeposits } = require("../../src/helpers");
const {
  executeDepositTx,
  executeMMRegistration,
  executeProvideLiquidity,
  executeCloseMM,
} = require("../../src/onchainInteractions");

const {
  registerMM,
  addLiquidity,
  removeLiquidity,
  closeMM,
} = require("invisible-sdk/src/transactions");

const path = require("path");
const fs = require("fs");
const { UserState } = require("invisible-sdk/src/users");
const { COLLATERAL_TOKEN_DECIMALS } = require("invisible-sdk/src/utils");

// * RERGISTER MM ---------------------------------------------------------------------------------------
async function registerMMOnchain() {
  // * Onchain deposits

  let configPath = path.join(__dirname, "perp_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let config = JSON.parse(mmConfigFile);

  let privKey = config.PRIVATE_KEY;
  let marketMaker = await UserState.loginUser(privKey);

  let syntheticToken = 453755560;
  let positionAddress =
    marketMaker.positionData[syntheticToken][0].position_header
      .position_address;
  let maxVlpSupply = 1_000_000 * 10 ** COLLATERAL_TOKEN_DECIMALS;

  console.log("positionAddress: ", positionAddress);

  let txRecipt = await executeMMRegistration(
    syntheticToken,
    positionAddress,
    maxVlpSupply
  );

  console.log(txRecipt);
}

// * ADD LIQUIDITY --------------------------------------------------------------------------------------
async function provideLiquidityOnchain() {
  // * Onchain deposits

  let configPath = path.join(__dirname, "perp_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let config = JSON.parse(mmConfigFile);

  let privKey = config.PRIVATE_KEY;
  let marketMaker = await UserState.loginUser(privKey);

  let syntheticToken = 453755560;
  let positionAddress =
    marketMaker.positionData[syntheticToken][0].position_header
      .position_address;
  let usdcAmount = 150;

  console.log("positionAddress: ", positionAddress);

  let txRecipt = await executeProvideLiquidity(
    syntheticToken,
    positionAddress,
    usdcAmount
  );

  console.log(txRecipt);
}

async function closeMMOnchain() {
  // * Onchain deposits

  let configPath = path.join(__dirname, "perp_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let config = JSON.parse(mmConfigFile);

  let privKey = config.PRIVATE_KEY;
  let marketMaker = await UserState.loginUser(privKey);

  let syntheticToken = 453755560;
  let positionAddress =
    marketMaker.positionData[syntheticToken][0].position_header
      .position_address;

  console.log("positionAddress: ", positionAddress);

  let txRecipt = await executeCloseMM(positionAddress);

  console.log(txRecipt);
}

// * ===============================================================================
// * HANDLE ONCHAIN MM ACTIONS (REGISTER, ADD LIQUIDITY, REMOVE LIQUIDITY, CLOSE MM)
async function handleOnchainMMActions() {
  // * Claim deposits

  let configPath = path.join(__dirname, "perp_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let config = JSON.parse(mmConfigFile);

  let privKey = config.PRIVATE_KEY;
  let marketMaker = await UserState.loginUser(privKey);

  let syntheticToken = 453755560;
  let positionAddress =
    marketMaker.positionData[syntheticToken][0].position_header
      .position_address;

  let mmActions = await marketMaker.fetchOnchainMMActions(positionAddress);

  console.log("mmActions: ", mmActions);

  for (const mmAction of mmActions) {
    try {
      switch (mmAction.action_type) {
        case "register_mm":
          await registerMM(marketMaker, mmAction);

          break;
        case "add_liquidity":
          await addLiquidity(marketMaker, mmAction);

          break;

        case "remove_liquidity":
          await removeLiquidity(marketMaker, mmAction);

          break;

        case "close_mm":
          await closeMM(marketMaker, mmAction);

          break;
      }
    } catch (error) {
      console.log("error: ", error);
      continue;
    }
  }
}

// registerMMOnchain();

// provideLiquidityOnchain();

// closeMMOnchain();

handleOnchainMMActions();

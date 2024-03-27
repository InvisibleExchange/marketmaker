const ethers = require("ethers");
const {
  removeLiquidity,
  addLiquidity,
  registerMM,
  closeMM,
} = require("invisible-sdk/src/transactions");

const EXCHANGE_CONFIG = require("../../exchange-config.json");
const SYNTHETIC_ASSETS = EXCHANGE_CONFIG["SYNTHETIC_ASSETS"];

function runSCMM(marketMaker, ethAddress) {
  // * Get a connection to the smart contract

  const provider = new ethers.providers.JsonRpcProvider(
    process.env.ETH_RPC_URL,
    "sepolia"
  );

  const addressConfig = require("../../address-config.json");
  const invisibleL1Address = addressConfig["L1"]["Invisible"];
  const invisibleL1Abi = require("../abis/InvisibleL1.json").abi;
  const invisibleL1Contract = new ethers.Contract(
    invisibleL1Address,
    invisibleL1Abi,
    provider
  );

  console.log("Running SCMM");

  // * new PerpMM Registration * //
  invisibleL1Contract.on(
    "newPerpMMRegistration",
    async (
      mm_owner,
      synthetic_asset,
      position_address,
      vlp_token,
      mmActionId
    ) => {
      // ? Sleep for 5 seconds to allow the server to process the request
      await new Promise((resolve) => setTimeout(resolve, 5_000));

      let position = findPosition(marketMaker, position_address.toBigInt());
      if (!position || mm_owner != ethAddress) return;

      let registerAction = {
        mm_owner: mm_owner,
        synthetic_asset,
        position_address: position_address.toBigInt(),
        vlp_token,
        action_id: mmActionId,
        action_type: "register_mm",
      };

      console.log("Registering MM: ", registerAction);

      await registerMM(marketMaker, registerAction);
    }
  );

  // * Add Liquidity * //
  invisibleL1Contract.on(
    "AddLiquidity",
    async (depositor, position_address, usdc_amount, mmActionId) => {
      // ? Sleep for 5 seconds to allow the server to process the request
      await new Promise((resolve) => setTimeout(resolve, 5000));

      let position = findPosition(marketMaker, position_address.toBigInt());
      if (!position?.position_header?.vlp_token) return;

      let addLiqAction = {
        depositor,
        position_address: position_address.toBigInt(),
        usdc_amount,
        action_id: mmActionId,
        action_type: "add_liquidity",
      };

      console.log("AddLiquidity MM: ", addLiqAction);

      await addLiquidity(marketMaker, addLiqAction);
    }
  );

  // * Remove Liquidity * //
  invisibleL1Contract.on(
    "RemoveLiquidity",
    async (
      depositor,
      position_address,
      initial_value,
      vlp_amount,
      mmActionId
    ) => {
      // ? Sleep for 5 seconds to allow the server to process the request
      await new Promise((resolve) => setTimeout(resolve, 5000));

      let position = findPosition(marketMaker, position_address.toBigInt());
      if (!position?.position_header?.vlp_token) return;

      let removeAction = {
        depositor,
        position_address: position_address.toBigInt(),
        initial_value,
        vlp_amount,
        action_id: mmActionId,
        action_type: "remove_liquidity",
      };

      console.log("RemoveLiquidity MM: ", removeAction);

      await removeLiquidity(marketMaker, removeAction);
    }
  );

  // * Close Position Event * //
  invisibleL1Contract.on(
    "ClosePositionEvent",
    async (
      position_address,
      mm_owner,
      initial_value_sum,
      vlp_amount_sum,
      mmActionId
    ) => {
      // ? Sleep for 5 seconds to allow the server to process the request
      await new Promise((resolve) => setTimeout(resolve, 5000));

      let position = findPosition(marketMaker, position_address.toBigInt());
      if (!position?.position_header?.vlp_token) return;

      let closeMMAction = {
        mm_owner,
        position_address: position_address.toBigInt(),
        initial_value_sum,
        vlp_amount_sum,
        action_id: mmActionId,
        action_type: "close_mm",
      };

      console.log("ClosePositionEvent MM: ", closeMMAction);

      await closeMM(marketMaker, closeMMAction);
    }
  );
}

function findPosition(marketMaker, position_address) {
  for (const asset of SYNTHETIC_ASSETS) {
    let assetPositions = marketMaker.positionData[asset];
    if (!assetPositions || assetPositions.length === 0) {
      continue;
    }

    let position = assetPositions.find(
      (pos) => pos.position_header.position_address == position_address
    );
    return position;
  }
}

module.exports = { runSCMM };

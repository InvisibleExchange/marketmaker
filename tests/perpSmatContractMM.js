const { makeDeposits, openOrderTab, _loginUser } = require("../helpers");
const {
  SPOT_MARKET_IDS_2_TOKENS,
  DECIMALS_PER_ASSET,
  COLLATERAL_TOKEN_DECIMALS,
  PERP_MARKET_IDS_2_TOKENS,
} = require("../src/helpers/utils");
const {
  sendRegisterMm,
  sendAddLiquidityUser,
  sendOnChainAddLiquidityMM,
  sendOnChainRemoveLiquidityUser,
  sendOnChainRemoveLiquidityMM,
  sendPerpOrder,
} = require("../src/transactions/constructOrders");

//

async function initMM() {
  let config = {
    MM_CONFIG: { privKey: 101248239572738957238572395803135238950951n },
  };

  //
  await makeDeposits([55555], [20_000], config);
}

async function initPosition() {
  let config = {
    MM_CONFIG: { privKey: 101248239572738957238572395803135238950951n },
  };
  let marketMaker = await _loginUser(config);

  await sendPerpOrder(
    marketMaker,
    "Long",
    1000,
    "Open",
    null,
    54321,
    0.05,
    1650,
    20_000,
    0.07,
    1,
    true,
    null
  );
}

async function registerMM() {
  let config = {
    MM_CONFIG: { privKey: 101248239572738957238572395803135238950951n },
  };

  let marketMaker = await _loginUser(config);

  let baseToken = PERP_MARKET_IDS_2_TOKENS[22];
  let position = marketMaker.positionData[baseToken][0];

  console.log("position before", position);

  let vlpToken = 13579;
  let maxVlpSupply = 1_000_000;

  await sendRegisterMm(
    marketMaker,
    vlpToken,
    maxVlpSupply,
    position.position_header.position_address,
    true,
    22
  );
}

async function addLiquidity() {
  // ? MARKET MAKER
  let mmConfig = {
    MM_CONFIG: { privKey: 101248239572738957238572395803135238950951n },
  };
  let marketMaker = await _loginUser(mmConfig);

  let baseToken = PERP_MARKET_IDS_2_TOKENS[22];
  let position = marketMaker.positionData[baseToken][0];
  console.log("position before", position);

  // ? USER
  let userConfig = {
    MM_CONFIG: { privKey: 22222n },
  };

  // await makeDeposits([55555], [5_000], userConfig);

  let user = await _loginUser(userConfig);
  if (user.getAvailableAmount(55555) == 0) {
    await makeDeposits([55555], [5_000], userConfig);

    user = await _loginUser(userConfig);
  }

  console.log("user quote amount", user.getAvailableAmount(55555));

  let vlpToken = 13579;

  let collateralAmount =
    user.getAvailableAmount(55555) / 10 ** COLLATERAL_TOKEN_DECIMALS;

  let res = await sendAddLiquidityUser(
    user,
    position.position_header.position_address,
    vlpToken,
    null,
    null,
    collateralAmount,
    22,
    true
  );

  await sendOnChainAddLiquidityMM(marketMaker, res);
}

async function removeLiquidity() {
  // ? MARKET MAKER
  let mmConfig = {
    MM_CONFIG: { privKey: 101248239572738957238572395803135238950951n },
  };
  let marketMaker = await _loginUser(mmConfig);

  let baseToken = PERP_MARKET_IDS_2_TOKENS[22];
  let position = marketMaker.positionData[baseToken][0];
  console.log("position before", position);

  // ? USER
  let userConfig = {
    MM_CONFIG: { privKey: 22222n },
  };
  let user = await _loginUser(userConfig);

  let vlpToken = 13579;

  let vlpBalance = user.getAvailableAmount(vlpToken);
  console.log("user vlp balance", vlpBalance);

  let grpcMessage = await sendOnChainRemoveLiquidityUser(
    user,
    position.position_header.position_address,
    vlpToken,
    null,
    null,
    22,
    true
  );

  // console.log("grpcMessage", grpcMessage);

  await sendOnChainRemoveLiquidityMM(marketMaker, grpcMessage);
}

async function main() {
  // await initMM();
  // await initPosition();
  // await registerMM();
  // await addLiquidity();
  // await removeLiquidity();
}

main();

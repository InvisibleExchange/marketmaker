const { makeDeposits } = require("../../helpers");

const { UserState } = require("invisible-sdk/src/users");
const {
  COLLATERAL_TOKEN_DECIMALS,
  PERP_MARKET_IDS_2_TOKENS,
} = require("invisible-sdk/src/helpers/utils");
const {
  sendRegisterMm,
  sendAddLiquidityUser,
  sendOnChainAddLiquidityMM,
  sendOnChainRemoveLiquidityUser,
  sendOnChainRemoveLiquidityMM,
  sendPerpOrder,
} = require("invisible-sdk/src/transactions");

//

async function initMM() {
  let privKey = 101248239572738957238572395803135238950951n;

  //
  await makeDeposits([55555], [20_000], privKey);
}

async function initPosition() {
  let privKey = 101248239572738957238572395803135238950951n;
  let marketMaker = await UserState.loginUser(privKey);

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
  let privKey = 101248239572738957238572395803135238950951n;
  let marketMaker = await UserState.loginUser(privKey);

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
  let privKey = 101248239572738957238572395803135238950951n;
  let marketMaker = await UserState.loginUser(privKey);

  let baseToken = PERP_MARKET_IDS_2_TOKENS[22];
  let position = marketMaker.positionData[baseToken][0];
  console.log("position before", position);

  // ? USER
  privKey = 22222n;

  // await makeDeposits([55555], [5_000], userConfig);

  let user = await UserState.loginUser(privKey);
  if (user.getAvailableAmount(55555) == 0) {
    await makeDeposits([55555], [5_000], privKey);

    user = await UserState.loginUser(privKey);
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
  let privKey = 101248239572738957238572395803135238950951n;
  let marketMaker = await UserState.loginUser(privKey);

  let baseToken = PERP_MARKET_IDS_2_TOKENS[22];
  let position = marketMaker.positionData[baseToken][0];
  console.log("position before", position);

  // ? USER
  privKey = 22222n;
  let user = await UserState.loginUser(privKey);

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

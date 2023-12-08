const { makeDeposits, openOrderTab } = require("../../helpers");
const {
  SPOT_MARKET_IDS_2_TOKENS,
  DECIMALS_PER_ASSET,
  COLLATERAL_TOKEN_DECIMALS,
} = require("invisible-sdk/src/helpers/utils");
const {
  sendRegisterMm,
  sendAddLiquidityUser,
  sendOnChainAddLiquidityMM,
  sendOnChainRemoveLiquidityUser,
  sendOnChainRemoveLiquidityMM,
  sendPerpOrder,
} = require("invisible-sdk/src/transactions/constructOrders");
const { UserState } = require("invisible-sdk/src/users");

//

async function initMM() {
  let privKey = 1111n;

  //
  await makeDeposits([55555, 54321], [100_000, 50], privKey);
}

async function initOrderTab() {
  let privKey = 1111n;

  await openOrderTab(12, privKey);
}

async function registerMM() {
  let privKey = 1111n;

  let marketMaker = await UserState.loginUser(privKey);

  let baseToken = SPOT_MARKET_IDS_2_TOKENS[12].base;
  let orderTab = marketMaker.orderTabData[baseToken][0];

  let vlpToken = 13579;
  let maxVlpSupply = 1_000_000;

  await sendRegisterMm(
    marketMaker,
    vlpToken,
    maxVlpSupply,
    orderTab.tab_header.pub_key,
    false,
    12
  );

  console.log("orderTab after register", orderTab);
}

async function addLiquidity() {
  // ? MARKET MAKER
  let privKey = 1111n;
  let marketMaker = await UserState.loginUser(privKey);

  let baseToken = SPOT_MARKET_IDS_2_TOKENS[12].base;
  let orderTab = marketMaker.orderTabData[baseToken][0];
  console.log("orderTab before", orderTab);

  // ? USER
  privKey = 125346348693467598134534758394543n;

  let user = await UserState.loginUser(privKey);
  if (
    user.getAvailableAmount(baseToken) == 0 ||
    user.getAvailableAmount(55555) == 0
  ) {
    await makeDeposits([55555, baseToken], [10_000, 5], privKey);

    user = await UserState.loginUser(privKey);
  }

  console.log("user base amount", user.getAvailableAmount(baseToken));
  console.log("user quote amount", user.getAvailableAmount(55555));

  let vlpToken = 13579;

  let baseAmount =
    user.getAvailableAmount(baseToken) / 10 ** DECIMALS_PER_ASSET[baseToken];
  let quoteAmount =
    user.getAvailableAmount(55555) / 10 ** COLLATERAL_TOKEN_DECIMALS;

  let res = await sendAddLiquidityUser(
    user,
    orderTab.tab_header.pub_key,
    vlpToken,
    Number.parseInt(baseAmount / 2),
    Number.parseInt(quoteAmount / 2),
    null,
    12,
    false
  );

  await sendOnChainAddLiquidityMM(marketMaker, res);
}

async function removeLiquidity() {
  let privKey = 1111n;
  let marketMaker = await UserState.loginUser(privKey);

  let baseToken = SPOT_MARKET_IDS_2_TOKENS[12].base;
  let orderTab = marketMaker.orderTabData[baseToken][0];
  console.log("orderTab before", orderTab);

  // ? USER
  privKey = 125346348693467598134534758394543n;
  let user = await UserState.loginUser(privKey);

  let vlpToken = 13579;

  let vlpBalance = user.getAvailableAmount(vlpToken);
  console.log("user vlp balance", vlpBalance);

  // let grpcMessage = await sendOnChainRemoveLiquidityUser(
  //   user,
  //   orderTab.tab_header.pub_key,
  //   vlpToken,
  //   2000.0,
  //   1,
  //   12,
  //   false
  // );

  // // console.log("grpcMessage", grpcMessage);

  // await sendOnChainRemoveLiquidityMM(marketMaker, grpcMessage);
}

async function main() {
  // await initMM();
  // await initOrderTab();
  // await registerMM();
  // await addLiquidity();
  // await removeLiquidity();
}

main();

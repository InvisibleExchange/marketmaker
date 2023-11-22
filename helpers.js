const {
  getActiveOrders,
  DECIMALS_PER_ASSET,
  CHAIN_IDS,
} = require("./src/helpers/utils");

const fs = require("fs");
const User = require("./src/users/Invisibl3User");
const {
  sendDeposit,
  sendOpenOrderTab,
  sendCloseOrderTab,
  sendModifyOrderTab,
} = require("./src/transactions/constructOrders");
const { restoreUserState } = require("./src/helpers/keyRetrieval");

const SPOT_MARKET_IDS_2_TOKENS = {
  11: { base: 12345, quote: 55555 },
  12: { base: 54321, quote: 55555 },
};

async function makeDeposits(tokens, amounts, config) {
  let marketMaker = await _loginUser(config);

  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i];
    let amount = amounts[i];

    let depositId = CHAIN_IDS["ETH Mainnet"] * 2 ** 32 + 12345;
    await sendDeposit(marketMaker, depositId, amount, token, 123456789);

    console.log(token, " amount: ", marketMaker.getAvailableAmount(token));
  }
}

// ? OPEN ORDER TAB ===========================================================
async function openOrderTab(marketId, config) {
  let marketMaker = await _loginUser(config);

  let baseToken = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
  let quoteToken = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

  let baseAmount = marketMaker.getAvailableAmount(baseToken);
  let quoteAmount = marketMaker.getAvailableAmount(quoteToken);

  await sendOpenOrderTab(
    marketMaker,
    baseAmount,
    quoteAmount,
    marketId,
    3600_000
  );

  console.log(marketMaker.orderTabData);
}

// ? CLOSE ORDER TAB ===========================================================
async function closeOrderTab(marketId, config) {
  let marketMaker = await _loginUser(config);

  let baseToken = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
  let quoteToken = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

  let baseAmount = marketMaker.getAvailableAmount(baseToken);
  let quoteAmount = marketMaker.getAvailableAmount(quoteToken);

  console.log("baseAmount before", baseAmount);
  console.log("quoteAmount before", quoteAmount);
  console.log("orderTab before: ", marketMaker.orderTabData[baseToken][0]);

  let tabAddress = marketMaker.orderTabData[baseToken][0].tab_header.pub_key;

  await sendCloseOrderTab(marketMaker, marketId, tabAddress);

  baseAmount = marketMaker.getAvailableAmount(baseToken);
  quoteAmount = marketMaker.getAvailableAmount(quoteToken);

  console.log("baseAmount after", baseAmount);
  console.log("quoteAmount after", quoteAmount);
  console.log("orderTab after: ", marketMaker.orderTabData[baseToken][0]);
}

// ? MODIFY ORDER TAB ===========================================================
async function modifyOrderTab(marketId, config) {
  let marketMaker = await _loginUser(config);

  let baseToken = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
  let quoteToken = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

  let baseAmount = marketMaker.getAvailableAmount(baseToken);
  let quoteAmount = marketMaker.getAvailableAmount(quoteToken);
  let orderTab = marketMaker.orderTabData[baseToken][0];

  console.log("baseAmount before", baseAmount);
  console.log("quoteAmount before", quoteAmount);
  console.log("orderTab before", orderTab);

  let tabAddress = marketMaker.orderTabData[baseToken][0].tab_header.pub_key;
  let baseAmountInput = 0.5 * 10 ** DECIMALS_PER_ASSET[baseToken];
  let quoteAmountInput = 15_000 * 10 ** DECIMALS_PER_ASSET[quoteToken];
  let isAdd = false;
  await sendModifyOrderTab(
    marketMaker,
    isAdd,
    baseAmountInput,
    quoteAmountInput,
    tabAddress,
    marketId
  );

  baseAmount = marketMaker.getAvailableAmount(baseToken);
  quoteAmount = marketMaker.getAvailableAmount(quoteToken);
  orderTab = marketMaker.orderTabData[baseToken][0];

  console.log("baseAmount after", baseAmount);
  console.log("quoteAmount after", quoteAmount);
  console.log("orderTab after", orderTab);
}

// HELPERS  ===================================================================

async function _loginUser(config) {
  let MM_CONFIG = config.MM_CONFIG;

  let marketMaker = User.fromPrivKey(MM_CONFIG.privKey);

  let { emptyPrivKeys, emptyPositionPrivKeys } = await marketMaker.login();

  let { badOrderIds, orders, badPerpOrderIds, perpOrders, pfrNotes } =
    await getActiveOrders(marketMaker.orderIds, marketMaker.perpetualOrderIds);

  await marketMaker.handleActiveOrders(
    badOrderIds,
    orders,
    badPerpOrderIds,
    perpOrders,
    pfrNotes,
    emptyPrivKeys,
    emptyPositionPrivKeys
  );

  return marketMaker;
}

const loadMMConfig = (configPath) => {
  // Load MM config
  let MM_CONFIG;
  if (process.env.MM_CONFIG) {
    MM_CONFIG = JSON.parse(process.env.MM_CONFIG);
  } else {
    const mmConfigFile = fs.readFileSync(configPath, "utf8");
    MM_CONFIG = JSON.parse(mmConfigFile);
  }

  let activeMarkets = [];
  for (let marketId of Object.keys(MM_CONFIG.pairs)) {
    if (MM_CONFIG.pairs[marketId].active) {
      activeMarkets.push(marketId);
    }
  }

  return { MM_CONFIG, activeMarkets };
};

module.exports = {
  loadMMConfig,
  makeDeposits,
  openOrderTab,
  closeOrderTab,
  modifyOrderTab,
  _loginUser,
};

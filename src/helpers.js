const {
  getActiveOrders,
  DECIMALS_PER_ASSET,
  CHAIN_IDS,
  IDS_TO_SYMBOLS,
} = require("invisible-sdk/src/utils");

const fs = require("fs");
const { UserState } = require("invisible-sdk/src/users");
const {
  sendDeposit,
  sendOpenOrderTab,
  sendCloseOrderTab,
  sendModifyOrderTab,
} = require("invisible-sdk/src/transactions");
const bigInt = require("big-integer");

const SPOT_MARKET_IDS_2_TOKENS = {
  11: { base: 3592681469, quote: 2413654107 },
  12: { base: 453755560, quote: 2413654107 },
};

async function makeDeposits(tokens, amounts, privKey) {
  let marketMaker = await UserState.loginUser(privKey);

  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i];
    let amount = amounts[i];

    let depositId = CHAIN_IDS["ETH Mainnet"] * 2 ** 32 + 12345;
    await sendDeposit(marketMaker, depositId, amount, token, 123456789);

    console.log(
      IDS_TO_SYMBOLS[token],
      " amount: ",
      marketMaker.getAvailableAmount(token)
    );
  }
}

// ? OPEN ORDER TAB ===========================================================
async function openOrderTab(marketId, privKey) {
  let marketMaker = await UserState.loginUser(privKey.toString());

  let baseToken = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
  let quoteToken = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

  let baseAmount = marketMaker.getAvailableAmount(baseToken);
  let quoteAmount = marketMaker.getAvailableAmount(quoteToken);

  console.log(" baseAmount: ", baseAmount, " quoteAmount: ", quoteAmount);

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
async function closeOrderTab(marketId, privKey) {
  let marketMaker = await UserState.loginUser(privKey);

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
async function modifyOrderTab(marketId, privKey) {
  let marketMaker = await UserState.loginUser(privKey);

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

function getSizeFromLeverage(indexPrice, leverage, margin) {
  if (indexPrice == 0) {
    return 0;
  }

  const size = (Number(margin) * Number(leverage)) / Number(indexPrice);

  return size;
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

function trimHash(hash, n_bits = 128) {
  // returns the last n_bits number of the number as bigInt
  return bigInt(hash).and(bigInt(1).shiftLeft(n_bits).prev()).value;
}

module.exports = {
  loadMMConfig,
  makeDeposits,
  openOrderTab,
  closeOrderTab,
  modifyOrderTab,
  trimHash,
  getSizeFromLeverage,
};

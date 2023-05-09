const User = require("./users/Invisibl3User");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();

const {
  SERVER_URL,
  COLLATERAL_TOKEN,
  COLLATERAL_TOKEN_DECIMALS,
  DECIMALS_PER_ASSET,
  handleNoteSplit,
  SPOT_MARKET_IDS_2_TOKENS,
  SYMBOLS_TO_IDS,
  SPOT_MARKET_IDS,
  getActiveOrders,
  IDS_TO_SYMBOLS,
  handleLiquidityUpdate,
  handleSwapResult,
  handlePerpSwapResult,
  DUST_AMOUNT_PER_ASSET,
} = require("./helpers/utils");

const {
  sendSpotOrder,
  cancelOrder,
  sendSplitOrder,
  sendAmendOrder,
  sendCancelOrder,
} = require("./transactions/constructOrders");

const setupPriceFeeds = require("./helpers/mmPriceFeeds");
const { trimHash } = require("./users/Notes");

let W3CWebSocket = require("websocket").w3cwebsocket;
let client;

const loadMMConfig = () => {
  // Load MM config
  let MM_CONFIG;
  if (process.env.MM_CONFIG) {
    MM_CONFIG = JSON.parse(process.env.MM_CONFIG);
  } else {
    const mmConfigFile = fs.readFileSync("config.json", "utf8");
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
const { MM_CONFIG, activeMarkets } = loadMMConfig();

dotenv.config();

const REFRESH_PERIOD = 600_000; // 10 minutes

// Globals
const PRICE_FEEDS = {};
let liquidity = {};
const setLiquidity = (liq) => {
  liquidity = liq;
};
let perpLiquidity = {};
const setPerpLiquidity = (liq) => {
  perpLiquidity = liq;
};

// Maps marketId to a list of active orders
let ACTIVE_ORDERS = {};
let activeOrdersMidPrice = {}; // { marketId: midPrice }

let marketMaker;
const isPerp = false;

//
async function fillOpenOrders() {
  for (let marketId of Object.values(SPOT_MARKET_IDS)) {
    let { base, quote } = SPOT_MARKET_IDS_2_TOKENS[marketId];

    if (
      !liquidity[base] ||
      !liquidity[base].bidQueue ||
      !liquidity[base].askQueue
    )
      continue;
    for (let order of liquidity[base].bidQueue) {
      let fillable = isOrderFillable(order, "b", base, quote);

      if (fillable.fillable) {
        sendFillRequest(order, fillable.walletId);
      } else if (!["badprice"].includes(fillable.reason)) {
        break;
      }
    }

    for (let order of liquidity[base].askQueue) {
      let fillable = isOrderFillable(order, "s", base, quote);

      if (fillable.fillable) {
        sendFillRequest(order, fillable.walletId);
      } else if (!["badprice"].includes(fillable.reason)) {
        break;
      }
    }
  }
}

// order: {price, amount, timestamp}
async function sendFillRequest(otherOrder, otherSide, marketId) {
  const baseAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
  const quoteAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

  const baseQuantity = otherOrder.amount;
  const quote = genQuote(baseAsset, otherSide, baseQuantity);

  sendSpotOrder(
    marketMaker,
    otherSide === "s" ? "Buy" : "Sell",
    65,
    baseAsset,
    quoteAsset,
    baseQuantity,
    quote.quoteQuantity,
    otherOrder.price,
    0.07,
    0.01,
    true,
    ACTIVE_ORDERS
  );
}

async function indicateLiquidity(marketIds = activeMarkets) {
  for (const marketId of marketIds) {
    if (!activeMarkets.includes(marketId)) continue;

    const mmConfig = MM_CONFIG.pairs[marketId];
    if (!mmConfig || !mmConfig.active) continue;

    let baseAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
    let quoteAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

    try {
      validatePriceFeed(baseAsset);
    } catch (e) {
      console.error(
        "Can not indicateLiquidity (" +
          IDS_TO_SYMBOLS[baseAsset] +
          ") because: " +
          e
      );
      continue;
    }

    const midPrice = mmConfig.invert
      ? 1 / PRICE_FEEDS[mmConfig.priceFeedPrimary]
      : PRICE_FEEDS[mmConfig.priceFeedPrimary];
    if (!midPrice) continue;

    // if (
    //   activeOrdersMidPrice[marketId] &&
    //   Math.abs((midPrice - activeOrdersMidPrice[marketId]) / midPrice) < 1e-5
    // )
    //   continue;

    const side = mmConfig.side || "d";

    let baseBalance = marketMaker.getAvailableAmount(baseAsset);
    let quoteBalance =
      marketMaker.getAvailableAmount(quoteAsset) / activeMarkets.length;

    // sum up all the active orders
    let activeOrderBaseValue = ACTIVE_ORDERS[marketId + "Sell"]
      ? ACTIVE_ORDERS[marketId + "Sell"].reduce(
          (acc, order) => acc + order.spendAmount,
          0
        )
      : 0;
    let activeOrderQuoteValue = ACTIVE_ORDERS[marketId + "Buy"]
      ? ACTIVE_ORDERS[marketId + "Buy"].reduce(
          (acc, order) => acc + order.spendAmount,
          0
        )
      : 0;

    let totalBaseBalance =
      (baseBalance + activeOrderBaseValue) /
      10 ** DECIMALS_PER_ASSET[baseAsset];
    let totalQuoteBalance =
      (quoteBalance + activeOrderQuoteValue) /
      10 ** DECIMALS_PER_ASSET[quoteAsset];

    const maxSellSize = Math.min(totalBaseBalance, mmConfig.maxSize);
    const maxBuySize = Math.min(totalQuoteBalance / midPrice, mmConfig.maxSize);

    // dont do splits if under 1000 USD
    const usdBaseBalance = totalBaseBalance * getPrice(baseAsset);
    const usdQuoteBalance = totalQuoteBalance * getPrice(quoteAsset);
    let buySplits =
      usdQuoteBalance && usdQuoteBalance < 1000
        ? 1
        : mmConfig.numOrdersIndicated || 4;
    let sellSplits =
      usdBaseBalance && usdBaseBalance < 1000
        ? 1
        : mmConfig.numOrdersIndicated || 4;

    if (usdQuoteBalance && usdQuoteBalance < 10 * buySplits)
      buySplits = Math.floor(usdQuoteBalance / 10);
    if (usdBaseBalance && usdBaseBalance < 10 * sellSplits)
      sellSplits = Math.floor(usdBaseBalance / 10);

    if (["b", "d"].includes(side) && maxBuySize > 0) {
      // make a clone of the  ACTIVE_ORDERS[marketId + "Buy"] array
      // because we will be removing orders from it
      let activeOrdersCopy = [];
      if (ACTIVE_ORDERS[marketId + "Buy"]) {
        activeOrdersCopy = [...ACTIVE_ORDERS[marketId + "Buy"]];
      }
      for (let i = 0; i < activeOrdersCopy.length; i++) {
        const buyPrice =
          midPrice *
          (1 -
            mmConfig.minSpread -
            (mmConfig.slippageRate * maxBuySize * i) / buySplits);

        let orderId = activeOrdersCopy[i].id;
        sendAmendOrder(
          marketMaker,
          orderId,
          "Buy",
          isPerp,
          marketId,
          buyPrice,
          MM_CONFIG.EXPIRATION_TIME,
          ACTIVE_ORDERS
        );
      }

      for (let i = activeOrdersCopy.length; i < buySplits; i++) {
        if (quoteBalance < DUST_AMOUNT_PER_ASSET[quoteAsset]) continue;

        const buyPrice =
          midPrice *
          (1 -
            mmConfig.minSpread -
            (mmConfig.slippageRate * maxBuySize * i) / buySplits);

        // PLACE ORDER
        await sendSplitOrder(
          marketMaker,
          quoteAsset,
          quoteBalance /
            10 ** DECIMALS_PER_ASSET[quoteAsset] /
            (buySplits - activeOrdersCopy.length)
        );
        await sendSpotOrder(
          marketMaker,
          "Buy",
          MM_CONFIG.EXPIRATION_TIME,
          baseAsset,
          quoteAsset,
          null,
          quoteBalance /
            10 ** DECIMALS_PER_ASSET[quoteAsset] /
            (buySplits - activeOrdersCopy.length),
          buyPrice,
          0.07,
          0,
          false,
          ACTIVE_ORDERS
        );
      }
    }

    if (["s", "d"].includes(side) && maxSellSize > 0) {
      // make a clone of the  ACTIVE_ORDERS[marketId + "Sell"] array
      // because we will be removing orders from it
      let activeOrdersCopy = [];
      if (ACTIVE_ORDERS[marketId + "Sell"]) {
        activeOrdersCopy = [...ACTIVE_ORDERS[marketId + "Sell"]];
      }

      for (let i = 0; i < activeOrdersCopy.length; i++) {
        const sellPrice =
          midPrice *
          (1 +
            mmConfig.minSpread +
            (mmConfig.slippageRate * maxSellSize * i) / sellSplits);

        let orderId = activeOrdersCopy[i].id;
        sendAmendOrder(
          marketMaker,
          orderId,
          "Sell",
          isPerp,
          marketId,
          sellPrice,
          MM_CONFIG.EXPIRATION_TIME,
          ACTIVE_ORDERS
        );
      }

      for (let i = activeOrdersCopy.length; i < sellSplits; i++) {
        if (baseBalance <= DUST_AMOUNT_PER_ASSET[baseAsset]) continue;

        const sellPrice =
          midPrice *
          (1 +
            mmConfig.minSpread +
            (mmConfig.slippageRate * maxSellSize * i) / sellSplits);

        await sendSplitOrder(
          marketMaker,
          baseAsset,
          baseBalance /
            10 ** DECIMALS_PER_ASSET[baseAsset] /
            (sellSplits - activeOrdersCopy.length)
        );
        await sendSpotOrder(
          marketMaker,
          "Sell",
          MM_CONFIG.EXPIRATION_TIME,
          baseAsset,
          quoteAsset,
          baseBalance /
            10 ** DECIMALS_PER_ASSET[baseAsset] /
            (sellSplits - activeOrdersCopy.length),
          null,
          sellPrice,
          0.07,
          0,
          false,
          ACTIVE_ORDERS
        );

        // PLACE ORDER
      }
    }

    activeOrdersMidPrice[marketId] = midPrice;

    //
  }
}

function cancelLiquidity(marketId) {
  activeOrdersMidPrice[marketId] = null;

  let baseAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].base;

  for (order of marketMaker.orders) {
    if (order.base_asset == baseAsset) {
      sendCancelOrder(
        marketMaker,
        order.order_id,
        order.order_side,
        isPerp,
        marketId
      );
    }
  }
}

async function afterFill(amountFilled, marketId) {
  //

  activeOrdersMidPrice[marketId] = null;

  const mmConfig = MM_CONFIG.pairs[marketId];
  if (!mmConfig) {
    return;
  }

  // ? Delay trading after fill for delayAfterFill seconds
  if (mmConfig.delayAfterFill) {
    let delayAfterFillMinSize;
    if (
      !Array.isArray(mmConfig.delayAfterFill) ||
      !mmConfig.delayAfterFill[1]
    ) {
      delayAfterFillMinSize = 0;
    } else {
      delayAfterFillMinSize = mmConfig.delayAfterFill[1];
    }

    if (amountFilled > delayAfterFillMinSize) {
      // no array -> old config
      // or array and amountFilled over minSize
      mmConfig.active = false;
      cancelLiquidity(marketId);
      console.log(
        `Set ${marketId} passive for ${mmConfig.delayAfterFill} seconds.`
      );
      setTimeout(() => {
        mmConfig.active = true;
        console.log(`Set ${marketId} active.`);
        indicateLiquidity([marketId]);
      }, mmConfig.delayAfterFill * 1000);
    }
  }

  // ? increaseSpreadAfterFill size might not be set
  const increaseSpreadAfterFillMinSize = mmConfig.increaseSpreadAfterFill?.[2]
    ? mmConfig.increaseSpreadAfterFill[2]
    : 0;
  if (
    mmConfig.increaseSpreadAfterFill &&
    amountFilled > increaseSpreadAfterFillMinSize
  ) {
    const [spread, time] = mmConfig.increaseSpreadAfterFill;
    mmConfig.minSpread = mmConfig.minSpread + spread;
    console.log(`Changed ${marketId} minSpread by ${spread}.`);
    indicateLiquidity(marketId);
    setTimeout(() => {
      mmConfig.minSpread = mmConfig.minSpread - spread;
      console.log(`Changed ${marketId} minSpread by -${spread}.`);
      indicateLiquidity(marketId);
    }, time * 1000);
  }

  // ? changeSizeAfterFill size might not be set
  const changeSizeAfterFillMinSize = mmConfig.changeSizeAfterFill?.[2]
    ? mmConfig.changeSizeAfterFill[2]
    : 0;
  if (
    mmConfig.changeSizeAfterFill &&
    amountFilled > changeSizeAfterFillMinSize
  ) {
    const [size, time] = mmConfig.changeSizeAfterFill;
    mmConfig.maxSize = mmConfig.maxSize + size;
    console.log(`Changed ${marketId} maxSize by ${size}.`);
    indicateLiquidity([marketId]);
    setTimeout(() => {
      mmConfig.maxSize = mmConfig.maxSize - size;
      console.log(`Changed ${marketId} maxSize by ${size * -1}.`);
      indicateLiquidity([marketId]);
    }, time * 1000);
  }
}

// * HELPER FUNCTIONS ==========================================================================================================

//order: {price, amount, timestamp}
function isOrderFillable(order, side, baseAsset, quoteAsset) {
  // const chainId = order[0];
  // const marketId = order[2];
  // const market = MARKETS[marketId];
  const mmConfig = MM_CONFIG.pairs[SPOT_MARKET_IDS[baseAsset]];
  const mmSide = mmConfig.side ? mmConfig.side : "d";
  // if (!market) return { fillable: false, reason: "badmarket" };
  if (!mmConfig.active) return { fillable: false, reason: "inactivemarket" };

  const price = order.price;
  const baseQuantity =
    order.amount / 10 ** DECIMALS_PER_ASSET[SYMBOLS_TO_IDS[baseAsset]];

  if (mmSide !== "d" && mmSide == side) {
    return { fillable: false, reason: "badside" };
  }

  if (baseQuantity < mmConfig.minSize || baseQuantity > mmConfig.maxSize) {
    return { fillable: false, reason: "badsize" };
  }

  let quote;
  try {
    quote = genQuote(baseAsset, side, baseQuantity);
  } catch (e) {
    return { fillable: false, reason: e.message };
  }
  if (
    (side == "s" && price > quote.quotePrice) ||
    (side == "b" && price < quote.quotePrice)
  ) {
    return { fillable: false, reason: "badprice" };
  }

  const sellAsset = side === "s" ? quoteAsset : baseAsset;
  const sellDecimals =
    side === "s"
      ? DECIMALS_PER_ASSET[quoteAsset]
      : DECIMALS_PER_ASSET[baseAsset];
  const sellQuantity = side === "s" ? quote.quoteQuantity : baseQuantity;
  const neededBalanceBN = sellQuantity * 10 ** sellDecimals;

  let availableAmount = marketMaker.getAvailableAmount(sellAsset);

  if (availableAmount < neededBalanceBN) {
    return { fillable: false, reason: "badbalance" };
  }

  return { fillable: true, reason: null };
}

function genQuote(baseAsset, side, baseQuantity) {
  if (!baseAsset) throw new Error("badmarket");
  if (!["b", "s"].includes(side)) throw new Error("badside");
  if (baseQuantity <= 0) throw new Error("badquantity");

  validatePriceFeed(marketId);

  const mmConfig = MM_CONFIG.pairs[SPOT_MARKET_IDS[baseAsset]];
  const mmSide = mmConfig.side || "d";
  if (mmSide !== "d" && mmSide === side) {
    throw new Error("badside");
  }

  const primaryPrice = mmConfig.invert
    ? 1 / PRICE_FEEDS[mmConfig.priceFeedPrimary]
    : PRICE_FEEDS[mmConfig.priceFeedPrimary];
  if (!primaryPrice) throw new Error("badprice");

  const SPREAD = mmConfig.minSpread + baseQuantity * mmConfig.slippageRate;
  let quoteQuantity;
  if (side === "b") {
    quoteQuantity = baseQuantity * primaryPrice * (1 + SPREAD) * (1 + 0.0007);
  } else if (side === "s") {
    quoteQuantity = (baseQuantity - (1 + 0.0007)) * primaryPrice * (1 - SPREAD);
  }
  const quotePrice = Number((quoteQuantity / baseQuantity).toPrecision(6));

  if (quotePrice < 0) throw new Error("Amount is inadequate to pay fee");
  if (isNaN(quotePrice)) throw new Error("Internal Error. No price generated.");

  return { quotePrice, quoteQuantity };
}

function validatePriceFeed(baseAsset) {
  const mmConfig = MM_CONFIG.pairs[SPOT_MARKET_IDS[baseAsset]];
  const primaryPriceFeedId = mmConfig.priceFeedPrimary;
  const secondaryPriceFeedId = mmConfig.priceFeedSecondary;

  // Constant mode checks
  const [mode, price] = primaryPriceFeedId.split(":");
  if (mode === "constant") {
    if (price > 0) return true;
    else throw new Error("No initPrice available");
  }

  // Check if primary price exists
  const primaryPrice = PRICE_FEEDS[primaryPriceFeedId];
  if (!primaryPrice) throw new Error("Primary price feed unavailable");

  // If there is no secondary price feed, the price auto-validates
  if (!secondaryPriceFeedId) return true;

  // Check if secondary price exists
  const secondaryPrice = PRICE_FEEDS[secondaryPriceFeedId];
  if (!secondaryPrice) throw new Error("Secondary price feed unavailable");

  // If the secondary price feed varies from the primary price feed by more than 1%, assume something is broken
  const percentDiff = Math.abs(primaryPrice - secondaryPrice) / primaryPrice;
  if (percentDiff > 0.03) {
    console.error("Primary and secondary price feeds do not match!");
    throw new Error("Circuit breaker triggered");
  }

  return true;
}

const getPrice = (token) => {
  if (token == COLLATERAL_TOKEN) {
    return 1;
  }

  return PRICE_FEEDS[MM_CONFIG.pairs[SPOT_MARKET_IDS[token]].priceFeedPrimary];
};

// * INITIALIZATION ==========================================================================================================

const listenToWebSocket = () => {
  client = new W3CWebSocket(`ws://${MM_CONFIG.SERVER_URL}:50053`);

  client.onopen = function () {
    const ID = trimHash(marketMaker.userId, 64);
    client.send(ID.toString());
    console.log("WebSocket Client Connected");
  };

  client.onmessage = function (e) {
    let msg = JSON.parse(e.data);

    // 1.)
    // "message_id": LIQUIDITY_UPDATE,
    // "type": "perpetual"/"spot"
    // "market":  11 / 12 / 21 / 22
    // "ask_liquidity": [ [price, size, timestamp], [price, size, timestamp], ... ]
    // "bid_liquidity": [ [price, size, timestamp], [price, size, timestamp], ... ]

    // 2.)
    // "message_id": "PERPETUAL_SWAP",
    // "order_id": u64,
    // "swap_response": responseObject,
    // -> handlePerpSwapResult(user, responseObject)

    // 3.)
    // "message_id": "SWAP_RESULT",
    // "order_id": u64,
    // "market_id": u16,
    // "swap_response": responseObject,
    // -> handleSwapResult(user, responseObject)

    // 4.)
    // "message_id": "SWAP_FILLED",
    // "type": "perpetual"/"spot"
    // "asset":  tokenId
    // "amount":  amount
    // "price":  price
    // "is_buy":  isBuy
    // "timestamp":  timestamp

    switch (msg.message_id) {
      case "LIQUIDITY_UPDATE":
        handleLiquidityUpdate(
          msg,
          liquidity,
          setLiquidity,
          perpLiquidity,
          setPerpLiquidity
        );
        break;

      case "SWAP_FILLED":
        if (msg.type == "perpetual") {
          // handleFillResult(marketMaker, msg, perpFills, setPerpFills);
        } else {
          // handleFillResult(marketMaker, msg, fills, setFills);
        }

        break;

      case "SWAP_RESULT":
        handleSwapResult(
          marketMaker,
          msg.order_id,
          msg.swap_response,
          msg.market_id,
          ACTIVE_ORDERS
        );

        afterFill(msg.new_amount_filled, msg.market_id);

        break;

      case "PERPETUAL_SWAP":
        handlePerpSwapResult(marketMaker, msg.order_id, msg.swap_response);

        break;

      default:
        break;
    }
  };

  client.onclose = function () {
    // setTimeout(() => {
    //   listenToWebSocket();
    // }, 5000);
  };
};

const initAccountState = async () => {
  try {
    let pausedMarkets = [];
    for (let marketId of Object.values(SPOT_MARKET_IDS)) {
      const mmConfig = MM_CONFIG.pairs[marketId];
      if (mmConfig.active) {
        mmConfig.active = false;
        pausedMarkets.push(marketId);
      }
    }

    let user_ = User.fromPrivKey(MM_CONFIG.privKey);

    let { emptyPrivKeys, emptyPositionPrivKeys } = await user_.login();

    // if the await statement isn't resolved in 10 seconds throw an error
    let cancelTimeout = false;
    const timeout = setTimeout(() => {
      if (cancelTimeout) return;
      throw new Error("updateAccountState timeout");
    }, 10_000);

    let { badOrderIds, orders, badPerpOrderIds, perpOrders, pfrNotes } =
      await getActiveOrders(user_.orderIds, user_.perpetualOrderIds);

    await user_.handleActiveOrders(
      badOrderIds,
      orders,
      badPerpOrderIds,
      perpOrders,
      pfrNotes,
      emptyPrivKeys,
      emptyPositionPrivKeys
    );

    cancelTimeout = true;

    marketMaker = user_;

    // cancel open orders
    for (let marketId of pausedMarkets) {
      const mmConfig = MM_CONFIG.pairs[marketId];
      mmConfig.active = true;

      if (marketMaker) {
        cancelLiquidity(marketId);
      }
    }

    ACTIVE_ORDERS = {};
  } catch (error) {
    console.log("login error", error);
    throw error;
  }
};

// * MAIN ====================================================================================================================

async function run() {
  // Setup price feeds
  await setupPriceFeeds(MM_CONFIG, PRICE_FEEDS);

  // Setup the market maker
  await initAccountState();

  // Strart listening to updates from the server
  if (!client || client.readyState !== client.OPEN) {
    listenToWebSocket();
  }

  // Check for fillable orders
  // let interval1 = setInterval(fillOpenOrders, 300);

  console.log(
    "Starting market making: ",
    marketMaker.getAvailableAmount(55555),
    "USDC",
    marketMaker.getAvailableAmount(54321),
    "ETH"
  );
  console.log("Starting liquidity provision");

  // brodcast orders to provide liquidity
  await indicateLiquidity();
  let interval2 = setInterval(async () => {
    await indicateLiquidity();
  }, 5000);

  await new Promise((r) => setTimeout(r, REFRESH_PERIOD));

  // clearInterval(intervalId1);
  clearInterval(interval2);

  return;
}

async function main() {
  try {
    await run();
  } catch (error) {
    console.log("error", error);
  }

  console.log("restarting");
  await main();
}

main();

//
//
//
//
//

// 2152008321 USDC 1575205755 ETH
// 3228 012 481 USDC 3 150 411 507 ETH

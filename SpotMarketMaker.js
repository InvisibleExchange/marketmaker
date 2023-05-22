const User = require("./src/users/Invisibl3User");
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
} = require("./src/helpers/utils");

const {
  sendSpotOrder,
  sendSplitOrder,
  sendAmendOrder,
  sendCancelOrder,
} = require("./src/transactions/constructOrders");

const setupPriceFeeds = require("./mmPriceFeeds");
const { trimHash } = require("./src/users/Notes");

let W3CWebSocket = require("websocket").w3cwebsocket;
let client;

const path = require("path");
const configPath = path.join(__dirname, "config.json");

const loadMMConfig = () => {
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
let MM_CONFIG, activeMarkets;

dotenv.config();

// How often do we refresh entire state (to prevent bugs and have a fresh version of the state)
const REFRESH_PERIOD = 3600_000; // 1 hour
// How often do we send liquidity indications (orders that make the market)
const LIQUIDITY_INDICATION_PERIOD = 5_000; // 5 seconds
// How often do we check if any orders can be filled
const FILL_ORDERS_PERIOD = 1_000; // 5 seconds

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
    if (!activeMarkets.includes(marketId.toString())) continue;

    let { base, quote } = SPOT_MARKET_IDS_2_TOKENS[marketId];

    if (!liquidity[base]) continue;

    if (liquidity[base].bidQueue) {
      for (let order of liquidity[base].bidQueue) {
        let fillable = isOrderFillable(order, "b", base, quote);

        if (fillable.fillable) {
          sendFillRequest(order, "b", marketId);
        } else if (fillable.reason.toString() == "badprice") {
          break;
        }
      }
    }

    if (liquidity[base].askQueue.reverse()) {
      for (let order of liquidity[base].askQueue) {
        let fillable = isOrderFillable(order, "s", base, quote);

        if (fillable.fillable) {
          sendFillRequest(order, "s", marketId);
        } else if (fillable.reason.toString() == "badprice") {
          break;
        }
      }
    }
  }
}

// order: {price, amount, timestamp}
async function sendFillRequest(otherOrder, otherSide, marketId) {
  const baseAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
  const quoteAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

  const baseQuantity = otherOrder.amount / 10 ** DECIMALS_PER_ASSET[baseAsset];
  const quote = genQuote(baseAsset, otherSide, baseQuantity);

  const spendAsset = otherSide === "s" ? quoteAsset : baseAsset;

  let availableAmount =
    marketMaker.getAvailableAmount(spendAsset) /
    10 ** DECIMALS_PER_ASSET[spendAsset];

  let unfilledAmount = otherSide === "s" ? quote.quoteQuantity : baseQuantity;

  const availableUsdBalance = availableAmount * getPrice(spendAsset);
  let unfilledUsdAmount = unfilledAmount * getPrice(spendAsset);

  if (availableUsdBalance >= 10 && unfilledUsdAmount >= 10) {
    sendSpotOrder(
      marketMaker,
      otherSide === "s" ? "Buy" : "Sell",
      MM_CONFIG.EXPIRATION_TIME,
      baseAsset,
      quoteAsset,
      availableAmount,
      availableAmount,
      otherOrder.price,
      0.07,
      0.01,
      true,
      ACTIVE_ORDERS
    );

    unfilledAmount -= availableAmount;
  }

  if (ACTIVE_ORDERS[otherSide === "s" ? marketId + "Buy" : marketId + "Sell"]) {
    let sortedOrders = ACTIVE_ORDERS[
      otherSide === "s" ? marketId + "Buy" : marketId + "Sell"
    ].sort((a, b) => {
      return otherSide === "b" ? a.price - b.price : b.price - a.price;
    });

    for (let order of sortedOrders) {
      if (
        unfilledAmount <
        DUST_AMOUNT_PER_ASSET[spendAsset] / 10 ** DECIMALS_PER_ASSET[spendAsset]
      )
        return;

      // Send amend order
      sendAmendOrder(
        marketMaker,
        order.id,
        otherSide === "s" ? "Buy" : "Sell",
        isPerp,
        marketId,
        otherSide === "s"
          ? otherOrder.price * (1 + 0.0001)
          : otherOrder.price * (1 - 0.0001),
        MM_CONFIG.EXPIRATION_TIME,
        true, // match_only
        ACTIVE_ORDERS
      );

      unfilledAmount -=
        order.spendAmount / 10 ** DECIMALS_PER_ASSET[spendAsset];
    }
  }
}

async function indicateLiquidity(marketIds = activeMarkets) {
  for (const marketId of marketIds) {
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
        // Todo Remove this after testing
        let extraTestSpread = 0;

        const buyPrice =
          midPrice *
            (1 -
              mmConfig.minSpread -
              (mmConfig.slippageRate * maxBuySize * i) / buySplits) -
          extraTestSpread;

        let orderId = activeOrdersCopy[i].id;
        sendAmendOrder(
          marketMaker,
          orderId,
          "Buy",
          isPerp,
          marketId,
          buyPrice,
          MM_CONFIG.EXPIRATION_TIME,
          false, // match_only
          ACTIVE_ORDERS
        );
      }

      for (let i = activeOrdersCopy.length; i < buySplits; i++) {
        if (quoteBalance < DUST_AMOUNT_PER_ASSET[quoteAsset]) continue;

        // Todo Remove this after testing
        let extraTestSpread = 0;

        const buyPrice =
          midPrice *
            (1 -
              mmConfig.minSpread -
              (mmConfig.slippageRate * maxBuySize * i) / buySplits) -
          extraTestSpread;

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
        // Todo Remove this after testing
        let extraTestSpread = 0;

        const sellPrice =
          midPrice *
            (1 +
              mmConfig.minSpread +
              (mmConfig.slippageRate * maxSellSize * i) / sellSplits) +
          extraTestSpread;

        let orderId = activeOrdersCopy[i].id;
        sendAmendOrder(
          marketMaker,
          orderId,
          "Sell",
          isPerp,
          marketId,
          sellPrice,
          MM_CONFIG.EXPIRATION_TIME,
          false, // match_only
          ACTIVE_ORDERS
        );
      }

      for (let i = activeOrdersCopy.length; i < sellSplits; i++) {
        if (baseBalance <= DUST_AMOUNT_PER_ASSET[baseAsset]) continue;

        // Todo Remove this after testing
        let extraTestSpread = 0;

        const sellPrice =
          midPrice *
            (1 +
              mmConfig.minSpread +
              (mmConfig.slippageRate * maxSellSize * i) / sellSplits) +
          extraTestSpread;

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
      !mmConfig.delayAfterFill.length > 1
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
  const increaseSpreadAfterFillMinSize =
    !Array.isArray(mmConfig.increaseSpreadAfterFill) &&
    mmConfig.increaseSpreadAfterFill.length > 2
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
  const changeSizeAfterFillMinSize =
    !Array.isArray(mmConfig.changeSizeAfterFill) &&
    mmConfig.changeSizeAfterFill.length > 2
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
  const baseQuantity = order.amount / 10 ** DECIMALS_PER_ASSET[baseAsset];

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

  return { fillable: true, reason: null };
}

function genQuote(baseAsset, side, baseQuantity) {
  if (!baseAsset) throw new Error("badmarket");
  if (!["b", "s"].includes(side)) throw new Error("badside");
  if (baseQuantity <= 0) throw new Error("badquantity");

  validatePriceFeed(baseAsset);

  const mmConfig = MM_CONFIG.pairs[SPOT_MARKET_IDS[baseAsset]];
  const mmSide = mmConfig.side || "d";
  if (mmSide !== "d" && mmSide === side) {
    throw new Error("badside");
  }

  const primaryPrice = mmConfig.invert
    ? 1 / PRICE_FEEDS[mmConfig.priceFeedPrimary]
    : PRICE_FEEDS[mmConfig.priceFeedPrimary];
  if (!primaryPrice) throw new Error("badprice");

  // TODO:  remove after testing
  const extraTestSpread = 0;

  const SPREAD = mmConfig.minSpread + baseQuantity * mmConfig.slippageRate;

  let quotePrice;
  let quoteQuantity;
  if (side === "b") {
    quotePrice = Number(
      ((primaryPrice - extraTestSpread) * (1 + SPREAD + 0.0007)).toPrecision(6)
    );
    quoteQuantity = baseQuantity * quotePrice;
  } else if (side === "s") {
    quotePrice = Number(
      ((primaryPrice + extraTestSpread) * (1 - SPREAD - 0.0007)).toPrecision(6)
    );
    quoteQuantity = baseQuantity * quotePrice;
  }

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

const CONFIG_CODE = "1234567890";
const listenToWebSocket = () => {
  client = new W3CWebSocket(`ws://${MM_CONFIG.SERVER_URL}:50053`);

  client.onopen = function () {
    const ID = trimHash(marketMaker.userId, 64);
    client.send(
      JSON.stringify({ user_id: ID.toString(), config_code: CONFIG_CODE })
    );
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
    let user_ = User.fromPrivKey(MM_CONFIG.privKey);

    let { emptyPrivKeys, emptyPositionPrivKeys } = await user_.login();

    // if the await statement isn't resolved in 10 seconds throw an error
    let cancelTimeout = false;
    const timeout = setTimeout(async () => {
      if (cancelTimeout) return;
      return await initAccountState();
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
    for (let marketId of Object.values(SPOT_MARKET_IDS)) {
      const mmConfig = MM_CONFIG.pairs[marketId];
      if (!mmConfig || !mmConfig.active) continue;

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
  let config = loadMMConfig();
  MM_CONFIG = config.MM_CONFIG;
  activeMarkets = config.activeMarkets;

  // Setup price feeds
  await setupPriceFeeds(MM_CONFIG, PRICE_FEEDS);

  // Setup the market maker
  await initAccountState();

  // Strart listening to updates from the server
  if (!client || client.readyState !== client.OPEN) {
    listenToWebSocket();
  }

  // Check for fillable orders
  let interval1 = setInterval(fillOpenOrders, FILL_ORDERS_PERIOD);

  // console.log(
  //   "note indexes usdc: ",
  //   marketMaker.noteData[55555].map((n) => n.index)
  // );
  // console.log(
  //   "note indexes eth: ",
  //   marketMaker.noteData[54321].map((n) => n.index)
  // );

  console.log(
    "Starting market making: ",
    marketMaker.getAvailableAmount(55555),
    "USDC",
    marketMaker.getAvailableAmount(54321),
    "ETH"
  );

  // brodcast orders to provide liquidity
  await indicateLiquidity();
  let interval2 = setInterval(async () => {
    await indicateLiquidity();
  }, LIQUIDITY_INDICATION_PERIOD);

  // await new Promise((r) => setTimeout(r, REFRESH_PERIOD));

  // clearInterval(interval1);
  // clearInterval(interval2);
}

async function main() {
  try {
    await run();
  } catch (error) {
    console.log("error", error);
    await run();
  }

  // console.log("restarting");
  // await main();
}

main();

//
//
//
//
//

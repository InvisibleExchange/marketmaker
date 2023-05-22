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
  PERP_MARKET_IDS,
  PERP_MARKET_IDS_2_TOKENS,
} = require("./src/helpers/utils");

const User = require("./src/users/Invisibl3User");

const {
  sendAmendOrder,
  sendCancelOrder,
  sendPerpOrder,
} = require("./src/transactions/constructOrders");

const setupPriceFeeds = require("./mmPriceFeeds");
const { trimHash } = require("./src/users/Notes");
const { getSizeFromLeverage } = require("./src/helpers/tradePriceCalculations");

let W3CWebSocket = require("websocket").w3cwebsocket;
let client;

const path = require("path");
const configPath = path.join(__dirname, "perp_config.json");

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
const isPerp = true;

//
async function fillOpenOrders() {
  for (let marketId of Object.values(PERP_MARKET_IDS)) {
    if (!activeMarkets.includes(marketId.toString())) continue;

    let syntheticToken = PERP_MARKET_IDS_2_TOKENS[marketId];

    if (!perpLiquidity[syntheticToken]) continue;

    if (perpLiquidity[syntheticToken].bidQueue) {
      for (let order of perpLiquidity[syntheticToken].bidQueue) {
        let fillable = isOrderFillable(order, "b", syntheticToken);

        if (fillable.fillable) {
          sendFillRequest(order, "b", marketId);
        } else if (fillable.reason.toString() == "badprice") {
          break;
        }
      }
    }

    if (perpLiquidity[syntheticToken].bidQueue) {
      for (let order of perpLiquidity[syntheticToken].askQueue.reverse()) {
        let fillable = isOrderFillable(order, "s", syntheticToken);

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
  const mmConfig = MM_CONFIG.pairs[marketId];
  if (!mmConfig || !mmConfig.active) return;

  let syntheticAsset = PERP_MARKET_IDS_2_TOKENS[marketId];

  const midPrice = mmConfig.invert
    ? 1 / PRICE_FEEDS[mmConfig.priceFeedPrimary]
    : PRICE_FEEDS[mmConfig.priceFeedPrimary];
  if (!midPrice) return;

  const baseQuantity =
    otherOrder.amount / 10 ** DECIMALS_PER_ASSET[syntheticAsset];

  let position = marketMaker.positionData[syntheticAsset][0];

  const margin = position.margin;

  const maxSynthetic = getSizeFromLeverage(
    midPrice,
    margin / 10 ** COLLATERAL_TOKEN_DECIMALS,
    mmConfig.maxLeverage
  );

  let addableValue;
  if (otherSide === "s") {
    // we send a buy order
    const positionLongSize =
      position.order_side == "Long"
        ? position.position_size / 10 ** DECIMALS_PER_ASSET[syntheticAsset]
        : 0;
    const activeBuyOrderValue = ACTIVE_ORDERS[marketId + "Buy"]
      ? ACTIVE_ORDERS[marketId + "Buy"].reduce(
          (acc, order) => acc + order.syntheticAmount,
          0
        )
      : 0;

    addableValue = maxSynthetic - activeBuyOrderValue - positionLongSize;
  } else {
    // we send a sell order
    const positionShortSize =
      position.order_side == "Short"
        ? position.position_size / 10 ** DECIMALS_PER_ASSET[syntheticAsset]
        : 0;
    // sum up all the active orders
    const activeSellOrderValue = ACTIVE_ORDERS[marketId + "Sell"]
      ? ACTIVE_ORDERS[marketId + "Sell"].reduce(
          (acc, order) => acc + order.syntheticAmount,
          0
        )
      : 0;

    addableValue = maxSynthetic - activeSellOrderValue - positionShortSize;
  }

  let unfilledAmount = baseQuantity;
  let unfilledUsdAmount = unfilledAmount * getPrice(syntheticAsset);

  if (
    addableValue * getPrice(syntheticAsset) >= 10 &&
    unfilledUsdAmount >= 10
  ) {
    await sendPerpOrder(
      marketMaker,
      otherSide == "s" ? "Long" : "Short",
      MM_CONFIG.EXPIRATION_TIME,
      "Modify",
      position.position_address,
      syntheticAsset,
      addableValue,
      otherOrder.price,
      null,
      0.07,
      0.01,
      true,
      ACTIVE_ORDERS
    );

    unfilledAmount -= addableValue;
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
        DUST_AMOUNT_PER_ASSET[syntheticAsset] /
          10 ** DECIMALS_PER_ASSET[syntheticAsset]
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
        order.syntheticAmount / 10 ** DECIMALS_PER_ASSET[syntheticAsset];
    }
  }
}

async function indicateLiquidity(marketIds = activeMarkets) {
  for (const marketId of marketIds) {
    const mmConfig = MM_CONFIG.pairs[marketId];
    if (!mmConfig || !mmConfig.active) continue;

    let syntheticAsset = PERP_MARKET_IDS_2_TOKENS[marketId];

    try {
      validatePriceFeed(syntheticAsset);
    } catch (e) {
      console.error(
        "Can not indicateLiquidity (" +
          IDS_TO_SYMBOLS[syntheticAsset] +
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

    if (!marketMaker.positionData[syntheticAsset]) continue;

    const side = mmConfig.side || "d";

    let position = marketMaker.positionData[syntheticAsset][0];

    const margin = position.margin;

    const maxSynthetic = getSizeFromLeverage(
      midPrice,
      margin / 10 ** COLLATERAL_TOKEN_DECIMALS,
      mmConfig.maxLeverage
    );

    // sum up all the active orders
    const activeSellOrderValue = ACTIVE_ORDERS[marketId + "Sell"]
      ? ACTIVE_ORDERS[marketId + "Sell"].reduce(
          (acc, order) => acc + order.syntheticAmount,
          0
        )
      : 0;
    const activeBuyOrderValue = ACTIVE_ORDERS[marketId + "Buy"]
      ? ACTIVE_ORDERS[marketId + "Buy"].reduce(
          (acc, order) => acc + order.syntheticAmount,
          0
        )
      : 0;

    const positionLongSize =
      position.order_side == "Long"
        ? position.position_size / 10 ** DECIMALS_PER_ASSET[syntheticAsset]
        : 0;
    const positionShortSize =
      position.order_side == "Short"
        ? position.position_size / 10 ** DECIMALS_PER_ASSET[syntheticAsset]
        : 0;

    const addableBuyValue =
      maxSynthetic - activeBuyOrderValue - positionLongSize;
    const addableSellValue =
      maxSynthetic - activeSellOrderValue - positionShortSize;

    const maxSize = Math.min(maxSynthetic, mmConfig.maxSize);

    // dont do splits if under 1000 USD
    const usdMaxValue = maxSynthetic * getPrice(syntheticAsset);
    let numSplits =
      usdMaxValue && usdMaxValue < 1000 ? 1 : mmConfig.numOrdersIndicated || 4;

    if (usdMaxValue && usdMaxValue < 10) {
      numSplits = 0;
    }

    if (["b", "d"].includes(side) && maxSize > 0) {
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
              (mmConfig.slippageRate * maxSize * i) / numSplits) -
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

      for (let i = activeOrdersCopy.length; i < numSplits; i++) {
        if (
          addableBuyValue <
          DUST_AMOUNT_PER_ASSET[syntheticAsset] /
            10 ** DECIMALS_PER_ASSET[syntheticAsset]
        )
          continue;

        // Todo Remove this after testing
        let extraTestSpread = 0;

        const buyPrice =
          midPrice *
            (1 -
              mmConfig.minSpread -
              (mmConfig.slippageRate * maxSize * i) / numSplits) -
          extraTestSpread;

        await sendPerpOrder(
          marketMaker,
          "Long",
          MM_CONFIG.EXPIRATION_TIME,
          "Modify",
          position.position_address,
          syntheticAsset,
          addableBuyValue / (numSplits - activeOrdersCopy.length),
          buyPrice,
          null,
          0.07,
          0,
          false,
          ACTIVE_ORDERS
        );
      }
    }

    if (["s", "d"].includes(side) && maxSize > 0) {
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
              (mmConfig.slippageRate * maxSize * i) / numSplits) +
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

      for (let i = activeOrdersCopy.length; i < numSplits; i++) {
        if (
          addableSellValue <=
          DUST_AMOUNT_PER_ASSET[syntheticAsset] /
            10 ** DECIMALS_PER_ASSET[syntheticAsset]
        )
          continue;

        // Todo Remove this after testing
        let extraTestSpread = 0;

        const sellPrice =
          midPrice *
            (1 +
              mmConfig.minSpread +
              (mmConfig.slippageRate * maxSize * i) / numSplits) +
          extraTestSpread;

        await sendPerpOrder(
          marketMaker,
          "Short",
          MM_CONFIG.EXPIRATION_TIME,
          "Modify",
          position.position_address,
          syntheticAsset,
          addableSellValue / (numSplits - activeOrdersCopy.length),
          sellPrice,
          null,
          0.07,
          0,
          false,
          ACTIVE_ORDERS
        );
      }
    }

    activeOrdersMidPrice[marketId] = midPrice;

    //
  }
}

function cancelLiquidity(marketId) {
  activeOrdersMidPrice[marketId] = null;

  let syntheticAsset = PERP_MARKET_IDS_2_TOKENS[marketId];

  for (order of marketMaker.perpetualOrders) {
    if (order.synthetic_token == syntheticAsset) {
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
function isOrderFillable(order, side, baseAsset) {
  let marketId = PERP_MARKET_IDS[baseAsset];
  const mmConfig = MM_CONFIG.pairs[marketId];
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

  const mmConfig = MM_CONFIG.pairs[PERP_MARKET_IDS[baseAsset]];
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
  const mmConfig = MM_CONFIG.pairs[PERP_MARKET_IDS[baseAsset]];
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

  return PRICE_FEEDS[MM_CONFIG.pairs[PERP_MARKET_IDS[token]].priceFeedPrimary];
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
        // if (msg.type == "perpetual") {
        //   // handleFillResult(marketMaker, msg, perpFills, setPerpFills);
        // } else {
        //   // handleFillResult(marketMaker, msg, fills, setFills);
        // }

        break;

      case "SWAP_RESULT":
        // handleSwapResult(
        //   marketMaker,
        //   msg.order_id,
        //   msg.swap_response,
        //   msg.market_id,
        //   ACTIVE_ORDERS
        // );

        // afterFill(msg.new_amount_filled, msg.market_id);

        break;

      case "PERPETUAL_SWAP":
        handlePerpSwapResult(
          marketMaker,
          msg.order_id,
          msg.swap_response,
          msg.marketId,
          ACTIVE_ORDERS
        );

        afterFill(msg.qty, msg.marketId);

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
    // if the await statement isn't resolved in 10 seconds throw an error
    let cancelTimeout = false;
    const timeout = setTimeout(async () => {
      if (cancelTimeout) return;
      return await initAccountState();
    }, 10_000);

    let user_ = User.fromPrivKey(MM_CONFIG.privKey);
    let { emptyPrivKeys, emptyPositionPrivKeys } = await user_.login();

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
    for (let marketId of Object.values(PERP_MARKET_IDS)) {
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

const initPositions = async () => {
  for (let marketId of Object.values(PERP_MARKET_IDS)) {
    const mmConfig = MM_CONFIG.pairs[marketId];
    if (!mmConfig || !mmConfig.active) continue;

    let syntheticAsset = PERP_MARKET_IDS_2_TOKENS[marketId];

    try {
      validatePriceFeed(syntheticAsset);
    } catch (e) {
      console.error(
        "Can not indicateLiquidity (" +
          IDS_TO_SYMBOLS[syntheticAsset] +
          ") because: " +
          e
      );
      continue;
    }

    const midPrice = mmConfig.invert
      ? 1 / PRICE_FEEDS[mmConfig.priceFeedPrimary]
      : PRICE_FEEDS[mmConfig.priceFeedPrimary];
    if (!midPrice) continue;

    if (!marketMaker.positionData[syntheticAsset]) {
      // OPEN POSITION

      let syntheticAsset = PERP_MARKET_IDS_2_TOKENS[marketId];
      let margin =
        marketMaker.getAvailableAmount(COLLATERAL_TOKEN) / activeMarkets.length;

      if (margin < DUST_AMOUNT_PER_ASSET[syntheticAsset] * 1.1) continue;

      margin = margin / 10 ** COLLATERAL_TOKEN_DECIMALS;

      await sendPerpOrder(
        marketMaker,
        "Long",
        MM_CONFIG.EXPIRATION_TIME,
        "Open",
        null,
        syntheticAsset,
        (DUST_AMOUNT_PER_ASSET[syntheticAsset] * 1.1) /
          10 ** DECIMALS_PER_ASSET[syntheticAsset],
        midPrice,
        margin,
        0.07,
        1,
        true,
        ACTIVE_ORDERS
      );
    }
  }
};

// * MAIN ====================================================================================================================

async function run() {
  let config = loadMMConfig();
  MM_CONFIG = config.MM_CONFIG;
  activeMarkets = config.activeMarkets;

  // Setup price feeds
  await setupPriceFeeds(MM_CONFIG, PRICE_FEEDS);

  await initAccountState();

  // Strart listening to updates from the server
  if (!client || client.readyState !== client.OPEN) {
    listenToWebSocket();
  }

  await initPositions();

  // Check for fillable orders
  let interval1 = setInterval(fillOpenOrders, FILL_ORDERS_PERIOD);

  console.log("Starting market making: ", marketMaker.positionData);

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

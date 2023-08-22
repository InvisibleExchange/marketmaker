const {
  checkPerpOrderValidity,
  getQtyFromQuote,
  getQuoteQty,
} = require("../helpers/orderHelpers");
const { trimHash, Note } = require("../users/Notes");

const axios = require("axios");
const { storeOrderId } = require("../helpers/firebase/firebaseConnection");

const { computeHashOnElements } = require("../helpers/pedersen");

const {
  SERVER_URL,
  COLLATERAL_TOKEN,
  COLLATERAL_TOKEN_DECIMALS,
  DECIMALS_PER_ASSET,
  PRICE_DECIMALS_PER_ASSET,
  handleNoteSplit,
  DUST_AMOUNT_PER_ASSET,
  SPOT_MARKET_IDS,
  PERP_MARKET_IDS,
  SPOT_MARKET_IDS_2_TOKENS,
} = require("../helpers/utils");
const {
  _getBankruptcyPrice,
  _getLiquidationPrice,
} = require("../helpers/tradePriceCalculations");
const { storeUserState } = require("../helpers/localStorage");
const LimitOrder = require("./LimitOrder");
const {
  handleLimitOrderResponse,
  handleBatchOrderResponse,
  handlePerpetualOrderResponse,
  handleCancelOrderResponse,
  handleAmendOrderResponse,
  handleDepositResponse,
  handleMarginChangeResponse,
} = require("./handleOrderResponses");
// const { restoreUserState } = require("../helpers/keyRetrieval");

// const path = require("path");
// require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const EXPRESS_APP_URL = `http://${SERVER_URL}:4000`; // process.env.EXPRESS_APP_URL;

/**
 * This constructs a spot swap and sends it to the backend
 * ## Params:
 * @param  order_side "Buy"/"Sell"
 * @param  expirationTime expiration time in seconds
 * @param  baseToken
 * @param  quoteToken (price token)
 * @param  baseAmount the amount of base tokens to be bought/sold (only for sell orders)
 * @param  quoteAmount the amount of quote tokens to be spent/received  (only for buy orders)
 * @param  price a) price of base token denominated in quote token (current price if market order)
 * @param  feeLimit fee limit in percentage (1 = 1%)
 * @param  tabAddress the address of the tab to be used (null if non-tab order)
 * @param  slippage  the slippage limit in percentage (1 = 1%) (null if limit)
 */
async function sendSpotOrder(
  user,
  order_side,
  expirationTime,
  baseToken,
  quoteToken,
  baseAmount,
  quoteAmount,
  price,
  feeLimit,
  tabAddress,
  slippage,
  isMarket,
  ACTIVE_ORDERS
) {
  if (
    !expirationTime ||
    !baseToken ||
    !quoteToken ||
    !(baseAmount || quoteAmount) ||
    !feeLimit ||
    !(order_side == "Buy" || order_side == "Sell")
  ) {
    console.log("Please fill in all fields");
    throw "Unfilled fields";
  }

  let baseDecimals = DECIMALS_PER_ASSET[baseToken];
  let quoteDecimals = DECIMALS_PER_ASSET[quoteToken];
  let priceDecimals = PRICE_DECIMALS_PER_ASSET[baseToken];

  let decimalMultiplier = baseDecimals + priceDecimals - quoteDecimals;

  let spendToken;
  let spendAmount;
  let receiveToken;
  let receiveAmount;
  if (order_side == "Buy") {
    spendToken = quoteToken;
    receiveToken = baseToken;

    spendAmount = Number.parseInt(quoteAmount * 10 ** quoteDecimals);
    let priceScaled = price * 10 ** priceDecimals;
    priceScaled = isMarket
      ? (priceScaled * (100 + slippage)) / 100
      : priceScaled;
    priceScaled = Number.parseInt(priceScaled);

    receiveAmount = Number.parseInt(
      (BigInt(spendAmount) * 10n ** BigInt(decimalMultiplier)) /
        BigInt(priceScaled)
    );
  } else {
    spendToken = baseToken;
    receiveToken = quoteToken;

    spendAmount = Number.parseInt(baseAmount * 10 ** baseDecimals);
    let priceScaled = price * 10 ** priceDecimals;
    priceScaled = isMarket
      ? (priceScaled * (100 - slippage)) / 100
      : priceScaled;
    priceScaled = Number.parseInt(priceScaled);

    receiveAmount = Number.parseInt(
      (BigInt(spendAmount) * BigInt(priceScaled)) /
        10n ** BigInt(decimalMultiplier)
    );
  }

  if (expirationTime < 0 || expirationTime > 3600_000)
    throw new Error("Expiration time Invalid");

  let ts = new Date().getTime() / 1000; // number of seconds since epoch
  let expirationTimestamp = Number.parseInt(ts.toString()) + expirationTime;

  feeLimit = Number.parseInt(((feeLimit * receiveAmount) / 100).toString());

  if (spendAmount > user.getAvailableAmount(spendToken) && !tabAddress) {
    if (
      spendAmount >
      user.getAvailableAmount(spendToken) + DUST_AMOUNT_PER_ASSET[spendToken]
    ) {
      console.log("Insufficient balance");
      throw new Error("Insufficient balance");
    }

    spendAmount = user.getAvailableAmount(spendToken);
  }

  let limitOrder = user.makeLimitOrder(
    expirationTimestamp,
    spendToken,
    receiveToken,
    spendAmount,
    receiveAmount,
    feeLimit,
    order_side,
    tabAddress
  );

  let orderJson = limitOrder.toGrpcObject();
  orderJson.user_id = trimHash(user.userId, 64).toString();
  orderJson.is_market = isMarket;

  user.awaittingOrder = true;

  await axios
    .post(`${EXPRESS_APP_URL}/submit_limit_order`, orderJson)
    .then(async (res) => {
      let order_response = res.data.response;

      if (order_response.successful) {
        user.orderIds.push(order_response.order_id);
        storeUserState(user.db, user);

        handleLimitOrderResponse(
          user,
          limitOrder,
          order_response,
          spendAmount,
          receiveAmount,
          price,
          baseToken,
          receiveToken,
          order_side,
          isMarket,
          ACTIVE_ORDERS
        );

        user.awaittingOrder = false;
      } else {
        let msg =
          "Failed to submit order with error: \n" +
          order_response.error_message;
        console.log(msg);

        user.awaittingOrder = false;
        throw new Error(msg);
      }
    });
}

//

/**
 * This constructs a spot swap and sends it to the backend
 * ## Params:
 * @param  order_side "Buy"/"Sell"
 * @param  expirationTime expiration time in seconds
 * @param  baseToken
 * @param  quoteToken (price token)
 * @param  prices
 * @param  amounts
 * @param  feeLimit fee limit in percentage (1 = 1%)
 */
async function sendBatchOrder(
  user,
  order_side,
  expirationTime,
  baseToken,
  quoteToken,
  prices,
  amounts,
  feeLimit,
  ACTIVE_ORDERS
) {
  if (
    !expirationTime ||
    !baseToken ||
    !quoteToken ||
    !feeLimit ||
    !(order_side == "Buy" || order_side == "Sell")
  ) {
    console.log("Please fill in all fields");
    throw "Unfilled fields";
  }
  if (prices.length != amounts.length) throw "prices.length != amounts.length";

  let baseDecimals = DECIMALS_PER_ASSET[baseToken];
  let quoteDecimals = DECIMALS_PER_ASSET[quoteToken];
  let priceDecimals = PRICE_DECIMALS_PER_ASSET[baseToken];

  let decimalMultiplier = baseDecimals + priceDecimals - quoteDecimals;

  let spendToken;
  let spendAmounts = [];
  let receiveToken;
  if (order_side == "Buy") {
    spendToken = quoteToken;
    receiveToken = baseToken;

    for (let i = 0; i < amounts.length; i++) {
      let amount = Number.parseInt(amounts[i] * 10 ** quoteDecimals);

      spendAmounts.push(amount);
    }
  } else {
    spendToken = baseToken;
    receiveToken = quoteToken;

    for (let i = 0; i < amounts.length; i++) {
      let amount = Number.parseInt(amounts[i] * 10 ** baseDecimals);

      spendAmounts.push(amount);
    }
  }

  if (expirationTime < 0 || expirationTime > 3600_000)
    throw new Error("Expiration time Invalid");

  let ts = new Date().getTime() / 1000; // number of seconds since epoch
  let expirationTimestamp = Number.parseInt(ts.toString()) + expirationTime;

  let spendAmountsSum = spendAmounts.reduce((a, b) => a + b, 0);
  if (spendAmountsSum > user.getAvailableAmount(spendToken)) {
    console.log("Insufficient balance");
    throw new Error("Insufficient balance");
  }

  let receiveAmount;
  if (order_side == "Buy") {
    let priceScaled = Number.parseInt(prices[0] * 10 ** priceDecimals);

    receiveAmount = Number.parseInt(
      (BigInt(spendAmountsSum) * 10n ** BigInt(decimalMultiplier)) /
        BigInt(priceScaled)
    );
  } else {
    let priceScaled = Number.parseInt(prices[0] * 10 ** priceDecimals);

    receiveAmount = Number.parseInt(
      (BigInt(spendAmountsSum) * BigInt(priceScaled)) /
        10n ** BigInt(decimalMultiplier)
    );
  }

  feeLimit = Number.parseInt(((feeLimit * receiveAmount) / 100).toString());

  let { limitOrder, pfrKey } = user.makeLimitOrder(
    expirationTimestamp,
    spendToken,
    receiveToken,
    spendAmountsSum,
    receiveAmount,
    feeLimit
  );

  let orderJson = limitOrder.toGrpcObject();
  orderJson.user_id = trimHash(user.userId, 64).toString();
  orderJson.is_market = false;
  orderJson.prices = prices;
  orderJson.amounts = spendAmounts;

  user.awaittingOrder = true;

  await axios
    .post(`${EXPRESS_APP_URL}/submit_limit_order`, orderJson)
    .then(async (res) => {
      let order_response = res.data.response;

      // throw new Error("Note does not exist");

      if (order_response.successful) {
        storeUserState(user.db, user);

        handleBatchOrderResponse(
          user,
          limitOrder,
          order_response,
          receiveAmount,
          spendAmounts,
          prices,
          baseToken,
          receiveToken,
          order_side,
          ACTIVE_ORDERS
        );

        user.awaittingOrder = false;
      } else {
        let msg =
          "Failed to submit order with error: \n" +
          order_response.error_message;
        console.log(msg);

        if (order_response.error_message.includes("Note does not exist")) {
          // todo: restoreUserState(user, true, false);
        }

        user.awaittingOrder = false;
        throw new Error(msg);
      }
    });
}

//

// * =====================================================================================================================================
// * =====================================================================================================================================
// * =====================================================================================================================================

/**
 * This constructs a perpetual swap and sends it to the backend
 * ## Params:
 * @param  order_side "Long"/"Short"
 * @param  expirationTime expiration time in hours
 * @param  position_effect_type "Open"/"Modify"/"Close"
 * @param  positionAddress the address of the position to be modified/closed (null if open)
 * @param  syntheticToken the token of the position to be opened
 * @param  syntheticAmount the amount of synthetic tokens to be bought/sold
 * @param  price (null if market order)
 * @param  initial_margin if the position is being opened (else null)
 * @param  feeLimit fee limit in percentage (10 = 10%)
 * @param  slippage  the slippage limit in percentage (1 = 1%) (null if limit)
 * @param  isMarket if the order is a market order
 */
async function sendPerpOrder(
  user,
  order_side,
  expirationTime,
  position_effect_type,
  positionAddress,
  syntheticToken,
  syntheticAmount_,
  price,
  initial_margin,
  feeLimit,
  slippage,
  isMarket,
  ACTIVE_ORDERS
) {
  let syntheticDecimals = DECIMALS_PER_ASSET[syntheticToken];
  let priceDecimals = PRICE_DECIMALS_PER_ASSET[syntheticToken];

  let decimalMultiplier =
    syntheticDecimals + priceDecimals - COLLATERAL_TOKEN_DECIMALS;

  let syntheticAmount = Number.parseInt(
    syntheticAmount_ * 10 ** syntheticDecimals
  );

  let scaledPrice = price * 10 ** priceDecimals;
  scaledPrice = isMarket
    ? order_side == "Long"
      ? (scaledPrice * (100 + slippage)) / 100
      : (scaledPrice * (100 - slippage)) / 100
    : scaledPrice;
  scaledPrice = Number.parseInt(scaledPrice);

  let collateralAmount =
    (BigInt(syntheticAmount) * BigInt(scaledPrice)) /
    10n ** BigInt(decimalMultiplier);
  collateralAmount = Number.parseInt(collateralAmount.toString());

  if (position_effect_type == "Open") {
    initial_margin = Number.parseInt(
      initial_margin * 10 ** COLLATERAL_TOKEN_DECIMALS
    );
  } else {
    if (!positionAddress) throw "Choose a position to modify/close";
  }

  if (expirationTime < 0 || expirationTime > 3600_000)
    throw new Error("Expiration time Invalid");

  let ts = new Date().getTime() / 1000; // number of seconds since epoch
  let expirationTimestamp = Number.parseInt(ts.toString()) + expirationTime;

  feeLimit = Number.parseInt(((feeLimit * collateralAmount) / 100).toString());

  checkPerpOrderValidity(
    user,
    order_side,
    position_effect_type,
    expirationTime,
    syntheticToken,
    syntheticAmount,
    COLLATERAL_TOKEN,
    collateralAmount,
    initial_margin,
    feeLimit
  );

  let { perpOrder } = user.makePerpetualOrder(
    expirationTimestamp,
    position_effect_type,
    positionAddress,
    order_side,
    syntheticToken,
    COLLATERAL_TOKEN,
    syntheticAmount,
    collateralAmount,
    feeLimit,
    initial_margin
  );

  user.awaittingOrder = true;

  let orderJson = perpOrder.toGrpcObject();
  orderJson.user_id = trimHash(user.userId, 64).toString();
  orderJson.is_market = isMarket;

  await axios
    .post(`${EXPRESS_APP_URL}/submit_perpetual_order`, orderJson)
    .then((res) => {
      let order_response = res.data.response;

      if (order_response.successful) {
        storeUserState(user.db, user);

        handlePerpetualOrderResponse(
          user,
          orderJson,
          perpOrder,
          order_response,
          syntheticAmount,
          syntheticAmount_,
          price,
          order_side,
          isMarket,
          ACTIVE_ORDERS
        );

        user.awaittingOrder = false;
      } else {
        let msg =
          "Failed to submit order with error: \n" +
          order_response.error_message;
        console.log(msg);

        user.awaittingOrder = false;
        throw new Error(msg);
      }
    });
}

/**
 * This constructs a perpetual swap and sends it to the backend
 * ## Params:
 * @param  position  the position to be modified/closed (null if open)
 * @param  price (null if market order)
 * @param  syntheticToken the token of the position to be opened
 * @param  syntheticAmount the amount of synthetic tokens to be bought/sold
 * @param  initial_margin if the position is being opened (else null)
 * @param  slippage  the slippage limit in percentage (1 = 1%) (null if limit)
 */
async function sendLiquidationOrder(
  user,
  position,
  price,
  syntheticToken,
  syntheticAmount,
  initial_margin,
  slippage
) {
  let syntheticDecimals = DECIMALS_PER_ASSET[syntheticToken];
  let priceDecimals = PRICE_DECIMALS_PER_ASSET[syntheticToken];

  let decimalMultiplier =
    syntheticDecimals + priceDecimals - COLLATERAL_TOKEN_DECIMALS;

  syntheticAmount = syntheticAmount * 10 ** syntheticDecimals;
  let scaledPrice = price * 10 ** priceDecimals;

  let order_side = position.order_side;
  scaledPrice =
    order_side == "Long"
      ? (scaledPrice * (100 + slippage)) / 100
      : (scaledPrice * (100 - slippage)) / 100;
  scaledPrice = Number.parseInt(scaledPrice);

  let collateralAmount =
    (BigInt(syntheticAmount) * BigInt(scaledPrice)) /
    10n ** BigInt(decimalMultiplier);
  collateralAmount = Number.parseInt(collateralAmount.toString());

  initial_margin = Number.parseInt(
    initial_margin * 10 ** COLLATERAL_TOKEN_DECIMALS
  );

  let liquidationOrder = user.makeLiquidationOrder(
    position,
    syntheticAmount,
    collateralAmount,
    initial_margin
  );

  let orderJson = liquidationOrder.toGrpcObject();
  orderJson.user_id = trimHash(user.userId, 64).toString();

  // console.log("order_json: ", orderJson, "\n\n\n");

  console.log("sending liquidation order");
  return await axios
    .post(`${EXPRESS_APP_URL}/submit_liquidation_order`, orderJson)
    .then((res) => {
      let order_response = res.data.response;

      console.log("order_response", order_response);

      if (order_response.successful) {
        // ? Save position data (if not null)

        let position = order_response.new_position;

        if (position) {
          position.order_side = position.order_side == 1 ? "Long" : "Short";

          if (
            !user.positionData[position.position_header.synthetic_token] ||
            user.positionData[position.position_header.synthetic_token]
              .length == 0
          ) {
            user.positionData[position.position_header.synthetic_token] = [
              position,
            ];
          } else {
            user.positionData[position.position_header.synthetic_token].push(
              position
            );
          }

          return position;
        }
      } else {
        let msg =
          "Failed to submit liquidation order with error: \n" +
          order_response.error_message;
        console.log(msg);

        if (
          order_response.error_message.includes("Note does not exist") ||
          order_response.error_message.includes("Position does not exist")
        ) {
          // todo: restoreUserState(user, true, true);
        }

        throw new Error(msg);
      }
    });
}

// * =====================================================================================================================================

/**
 * Sends a cancell order request to the server
 * ## Params:
 * @param orderId order id of order to cancel
 * @param orderSide true-Bid, false-Ask
 * @param isPerp
 * @param marketId market id of the order
 * @param errorCounter
 * @param dontUpdateState -if cancelling a batch order you dont want to update the state
 */
async function sendCancelOrder(
  user,
  orderId,
  orderSide,
  isPerp,
  marketId,
  errorCounter,
  dontUpdateState = false
) {
  if (!(isPerp === true || isPerp === false) || !marketId || !orderId) {
    throw new Error("Invalid parameters");
  }

  if (orderSide === 1 || orderSide === false || orderSide == "Short") {
    orderSide = false;
  } else if (orderSide === 0 || orderSide === true || orderSide == "Long") {
    orderSide = true;
  } else {
    throw new Error("Invalid order side");
  }

  let cancelReq = {
    marketId: marketId,
    order_id: orderId.toString(),
    order_side: orderSide,
    user_id: trimHash(user.userId, 64).toString(),
    is_perp: isPerp,
  };

  await axios
    .post(`${EXPRESS_APP_URL}/cancel_order`, cancelReq)
    .then((response) => {
      let order_response = response.data.response;

      if (order_response.successful) {
        if (dontUpdateState) return;

        handleCancelOrderResponse(user, order_response, orderId, isPerp);
      } else {
        let msg =
          "Failed to cancel order with error: \n" +
          order_response.error_message +
          " id: " +
          orderId;
        // console.log(msg);

        errorCounter++;
      }
    })
    .catch((err) => {
      console.log("Error submitting cancel order: ", err);
    });
}

// * =====================================================================================================================================

/**
 * Sends an amend order request to the server
 * ## Params:
 * @param orderId order id of order to cancel
 * @param orderSide "Buy"/"Sell"
 * @param isPerp
 * @param marketId market id of the order
 * @param newPrice new price of the order
 * @param newExpirationTime new expiration time in seconds
 * @param tabAddress the address of the order tab to be used (null if non-tab order)
 * @param match_only true if order should be matched only, false if matched and amended
 * @returns true if order should be removed, false otherwise
 */

async function sendAmendOrder(
  user,
  orderId,
  order_side,
  isPerp,
  marketId,
  newPrice,
  newExpirationTime,
  tabAddress,
  match_only,
  ACTIVE_ORDERS,
  errorCounter
) {
  let ts = new Date().getTime() / 1000; // number of seconds since epoch
  let expirationTimestamp = Number.parseInt(ts.toString()) + newExpirationTime;

  if (
    !(isPerp === true || isPerp === false) ||
    !marketId ||
    !orderId ||
    !newPrice ||
    !newExpirationTime ||
    (order_side !== "Buy" && order_side !== "Sell")
  )
    return;

  newPrice = Number(newPrice);

  let order;
  let signature;
  if (isPerp) {
    let ord = user.perpetualOrders.filter((o) => o.order_id == orderId)[0];
    if (
      !ord ||
      (ord.position_effect_type != "Open" && !ord.position) ||
      (ord.position_effect_type == "Open" && !ord.open_order_fields)
    ) {
      ACTIVE_ORDERS[marketId.toString() + order_side] = ACTIVE_ORDERS[
        marketId.toString() + order_side
      ].filter((o) => o.id != orderId);
      return;
    }

    let newCollateralAmount = getQuoteQty(
      ord.synthetic_amount,
      newPrice,
      ord.synthetic_token,
      COLLATERAL_TOKEN,
      null
    );

    ord.collateral_amount = newCollateralAmount;
    ord.expiration_timestamp = expirationTimestamp;

    if (ord.position_effect_type == "Open") {
      // open order
      let privKeys = ord.open_order_fields.notes_in.map(
        (note) => user.notePrivKeys[note.address.getX().toString()]
      );

      let sig = ord.signOrder(privKeys, null);
      signature = sig;
    } else {
      let position_priv_key =
        user.positionPrivKeys[ord.position.position_header.position_address];

      let sig = ord.signOrder(null, position_priv_key);
      signature = sig;
    }

    order = ord;
  } else {
    let ord = user.orders.filter((o) => o.order_id == orderId)[0];
    if (!ord) {
      ACTIVE_ORDERS[marketId.toString() + order_side] = ACTIVE_ORDERS[
        marketId.toString() + order_side
      ].filter((o) => o.id != orderId);
      return;
    }

    if (order_side == "Buy") {
      let newAmountReceived = getQtyFromQuote(
        ord.amount_spent,
        newPrice,
        ord.token_received,
        ord.token_spent
      );

      ord.amount_received = newAmountReceived;
      ord.expiration_timestamp = expirationTimestamp;
    } else {
      let newAmountReceived = getQuoteQty(
        ord.amount_spent,
        newPrice,
        ord.token_spent,
        ord.token_received,
        null
      );

      ord.amount_received = newAmountReceived;
      ord.expiration_timestamp = expirationTimestamp;
    }

    // let privKeys = ord.notes_in.map(
    //   (note) => user.notePrivKeys[note.address.getX().toString()]
    // );

    let privKey = user.tabPrivKeys[tabAddress];

    let sig = ord.signOrder(privKey);

    signature = sig;
    order = ord;
  }

  let amendReq = {
    market_id: marketId,
    order_id: orderId.toString(),
    order_side: order_side == "Buy",
    new_price: newPrice,
    new_expiration: expirationTimestamp,
    signature: { r: signature[0].toString(), s: signature[1].toString() },
    user_id: trimHash(user.userId, 64).toString(),
    is_perp: isPerp,
    match_only,
  };

  return axios.post(`${EXPRESS_APP_URL}/amend_order`, amendReq).then((res) => {
    let order_response = res.data.response;

    if (order_response.successful) {
      handleAmendOrderResponse(user, isPerp, order, orderId);
    } else {
      let msg =
        "Amend order failed with error: \n" + order_response.error_message;
      console.log(msg);

      ACTIVE_ORDERS[marketId.toString() + order_side] = ACTIVE_ORDERS[
        marketId.toString() + order_side
      ].filter((o) => o.id != orderId);

      errorCounter++;
    }
  });
}

// * =====================================================================================================================================

async function sendDeposit(user, depositId, amount, token, pubKey) {
  if (!user || !amount || !token || !depositId || !pubKey) {
    throw new Error("Invalid input");
  }

  let tokenDecimals = DECIMALS_PER_ASSET[token];
  amount = amount * 10 ** tokenDecimals;

  let deposit = user.makeDepositOrder(depositId, amount, token, pubKey);

  await axios
    .post(`${EXPRESS_APP_URL}/execute_deposit`, deposit.toGrpcObject())
    .then((res) => {
      let deposit_response = res.data.response;

      if (deposit_response.successful) {
        handleDepositResponse(user, deposit_response, deposit);
      } else {
        let msg =
          "Deposit failed with error: \n" + deposit_response.error_message;
        console.log(msg);

        if (deposit_response.error_message.includes("Note does not exist")) {
          // todo: restoreUserState(user, true, false);
        }

        throw new Error(msg);
      }
    });
}

// * ======================================================================

async function sendWithdrawal(user, amount, token, starkKey) {
  if (!user || !amount || !token || !starkKey) {
    throw new Error("Invalid input");
  }

  let tokenDecimals = DECIMALS_PER_ASSET[token];
  amount = amount * 10 ** tokenDecimals;

  let withdrawal = user.makeWithdrawalOrder(amount, token, starkKey);

  await axios
    .post(`${EXPRESS_APP_URL}/execute_withdrawal`, withdrawal.toGrpcObject())
    .then((res) => {
      let withdrawal_response = res.data.response;

      if (withdrawal_response.successful) {
        for (let i = 0; i < withdrawal.notes_in.length; i++) {
          let note = withdrawal.notes_in[i];
          user.noteData[note.token] = user.noteData[note.token].filter(
            (n) => n.index != note.index
          );
          // removeNoteFromDb(note);
        }
      } else {
        let msg =
          "Withdrawal failed with error: \n" +
          withdrawal_response.error_message;
        console.log(msg);

        if (withdrawal_response.error_message.includes("Note does not exist")) {
          // todo: restoreUserState(user, true, false);
        }

        throw new Error(msg);
      }
    });
}

// * ======================================================================

/**
 * Restructures notes to have new amounts. This is useful if you don't want to wait for an order to be filled before you receive a refund.
 * ## Params:
 * @param token - token to restructure notes for
 * @param newAmounts - array of new amounts
 */
async function sendSplitOrder(user, token, newAmount) {
  newAmount = Number.parseInt(newAmount * 10 ** DECIMALS_PER_ASSET[token]);

  let res = user.restructureNotes(token, newAmount);
  if (!res || !res.notesIn || res.notesIn.length == 0) return;
  let { notesIn, newNote, refundNote } = res;

  res = await axios.post(`${EXPRESS_APP_URL}/split_notes`, {
    notes_in: notesIn.map((n) => n.toGrpcObject()),
    note_out: newNote.toGrpcObject(),
    refund_note: refundNote ? refundNote.toGrpcObject() : null,
  });

  let split_response = res.data.response;

  if (split_response.successful) {
    let zero_idxs = split_response.zero_idxs;

    handleNoteSplit(user, zero_idxs, notesIn, [newNote, refundNote]);
  } else {
    let msg = "Note split failed with error: \n" + split_response.error_message;
    console.log(msg);

    if (split_response.error_message.includes("Note does not exist")) {
      // todo: restoreUserState(user, true, false);
    }

    throw new Error(msg);
  }
}

// * ======================================================================

/**
 * Sends a change margin order to the server, which add or removes margin from a position
 * ## Params:
 * @param positionAddress address of the position to change margin on
 * @param syntheticToken token of the position
 * @param amount amount of margin to add or remove
 * @param direction "Add"/"Remove"
 */
async function sendChangeMargin(
  user,
  positionAddress,
  syntheticToken,
  amount,
  direction
) {
  let margin_change = amount * 10 ** COLLATERAL_TOKEN_DECIMALS;

  let { notes_in, refund_note, close_order_fields, position, signature } =
    user.changeMargin(
      positionAddress,
      syntheticToken,
      direction,
      margin_change
    );
  let marginChangeMessage = {
    margin_change:
      direction == "Add"
        ? margin_change.toString()
        : (-margin_change).toString(),
    notes_in: notes_in ? notes_in.map((n) => n.toGrpcObject()) : null,
    refund_note: refund_note ? refund_note.toGrpcObject() : null,
    close_order_fields: close_order_fields
      ? close_order_fields.toGrpcObject()
      : null,
    position: {
      ...position,
      order_side: position.order_side == "Long" ? 1 : 0,
    },
    signature: {
      r: signature[0].toString(),
      s: signature[1].toString(),
    },
  };

  await axios
    .post(`${EXPRESS_APP_URL}/change_position_margin`, marginChangeMessage)
    .then((res) => {
      let marginChangeResponse = res.data.response;
      if (marginChangeResponse.successful) {
        handleMarginChangeResponse(
          user,
          marginChangeResponse,
          direction,
          notes_in,
          refund_note,
          position,
          close_order_fields,
          margin_change,
          syntheticToken,
          positionAddress
        );
      } else {
        let msg =
          "Failed to submit order with error: \n" +
          marginChangeResponse.error_message;
        console.log(msg);

        if (
          marginChangeResponse.error_message.includes("Note does not exist") ||
          marginChangeResponse.error_message.includes("Position does not exist")
        ) {
          // todo: restoreUserState(user, true, true);
        }

        throw new Error(msg);
      }
    });
}

// * ======================================================================

/**
 * Sends a request to open an order tab
 * ## Params:
 * @param baseAmount the amount of base token to supply
 * @param quoteAmount the amount of quote token to supply
 * @param marketId  determines which market (base/quote token) to use
 */
async function sendOpenOrderTab(user, baseAmount, quoteAmount, marketId) {
  let baseToken = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
  let quoteToken = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

  if (user.getAvailableAmount(baseToken) < baseAmount) return;
  if (user.getAvailableAmount(quoteToken) < quoteAmount) return;

  let grpcMessage = user.openNewOrderTab(baseAmount, quoteAmount, marketId);

  await axios
    .post(`${EXPRESS_APP_URL}/open_order_tab`, grpcMessage)
    .then((res) => {
      let openTabResponse = res.data.response;
      if (openTabResponse.successful) {
        // ? Store the userData locally
        storeUserState(user.db, user);

        console.log("openTabResponse: ", openTabResponse);

        if (!user.orderTabData[baseToken]) user.orderTabData[baseToken] = [];

        user.orderTabData[baseToken].push(grpcMessage.order_tab);
      } else {
        let msg =
          "Failed to submit order with error: \n" +
          openTabResponse.error_message;
        console.log(msg);

        throw new Error(msg);
      }
    });
}

// * ======================================================================

/**
 * Sends a request to open an order tab
 * ## Params:
 * @param marketId  determines which market (base/quote token) to use
 * @param orderTab  the order tab to close
 * @param expirationTime  time untill order tab expires
 */
async function sendCloseOrderTab(user, marketId, tabAddress) {
  let baseToken = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
  let quoteToken = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

  let { orderTab, baseCloseOrderFields, quoteCloseOrderFields, signature } =
    user.closeOrderTab(tabAddress, baseToken, quoteToken);

  let grpcMessage = {
    order_tab: orderTab.toGrpcObject(),
    signature: {
      r: signature[0].toString(),
      s: signature[1].toString(),
    },
    base_close_order_fields: baseCloseOrderFields.toGrpcObject(),
    quote_close_order_fields: quoteCloseOrderFields.toGrpcObject(),
    base_amount_change: orderTab.base_amount,
    quote_amount_change: orderTab.quote_amount,
  };

  await axios
    .post(`${EXPRESS_APP_URL}/close_order_tab`, grpcMessage)
    .then((res) => {
      let closeTabResponse = res.data.response;

      console.log(closeTabResponse);

      if (closeTabResponse.successful) {
        // ? Store the userData locally
        storeUserState(user.db, user);

        user.orderTabData[baseToken].filter(
          (tab) => tab.address != closeTabResponse.address
        );

        let baseReturnNote = Note.fromGrpcObject(
          closeTabResponse.base_return_note
        );
        let quoteReturnNote = Note.fromGrpcObject(
          closeTabResponse.quote_return_note
        );

        if (!user.noteData[baseToken]) user.noteData[baseToken] = [];
        if (!user.noteData[quoteToken]) user.noteData[quoteToken] = [];
        user.noteData[baseToken].push(baseReturnNote);
        user.noteData[quoteToken].push(quoteReturnNote);
      } else {
        let msg =
          "Failed to submit order with error: \n" +
          closeTabResponse.error_message;
        console.log(msg);

        throw new Error(msg);
      }
    });
}

// * ======================================================================

async function sendModifyOrderTab(
  user,
  isAdd,
  baseAmount,
  quoteAmount,
  tabAddress,
  marketId
) {
  let baseToken = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
  let quoteToken = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

  let grpcMessage;
  if (isAdd) {
    if (user.getAvailableAmount(baseToken) < baseAmount) return;
    if (user.getAvailableAmount(quoteToken) < quoteAmount) return;

    let {
      orderTab,
      baseNotesIn,
      quoteNotesIn,
      baseRefundNote,
      quoteRefundNote,
      signature,
    } = user.modifyOrderTab(
      baseAmount,
      quoteAmount,
      marketId,
      tabAddress,
      isAdd
    );

    grpcMessage = {
      base_notes_in: baseNotesIn.map((n) => n.toGrpcObject()),
      quote_notes_in: quoteNotesIn.map((n) => n.toGrpcObject()),
      base_refund_note: baseRefundNote.toGrpcObject(),
      quote_refund_note: quoteRefundNote.toGrpcObject(),
      signature: {
        r: signature[0].toString(),
        s: signature[1].toString(),
      },
      base_close_order_fields: null,
      quote_close_order_fields: null,
      order_tab: orderTab.toGrpcObject(),
      base_amount_change: baseAmount,
      quote_amount_change: quoteAmount,
      is_add: isAdd,
      market_id: marketId,
    };
  } else {
    let { orderTab, baseCloseOrderFields, quoteCloseOrderFields, signature } =
      user.modifyOrderTab(baseAmount, quoteAmount, marketId, tabAddress, isAdd);

    grpcMessage = {
      base_notes_in: null,
      quote_notes_in: null,
      base_refund_note: null,
      quote_refund_note: null,
      signature: {
        r: signature[0].toString(),
        s: signature[1].toString(),
      },
      base_close_order_fields: baseCloseOrderFields.toGrpcObject(),
      quote_close_order_fields: quoteCloseOrderFields.toGrpcObject(),
      order_tab: orderTab.toGrpcObject(),
      base_amount_change: baseAmount,
      quote_amount_change: quoteAmount,
      is_add: isAdd,
      market_id: marketId,
    };
  }

  await axios
    .post(
      `${EXPRESS_APP_URL}/{isAdd ? open_order_tab : close_order_tab}`,
      grpcMessage
    )
    .then((res) => {
      let modifyTabResponse = res.data.response;
      if (modifyTabResponse.successful) {
        // ? Store the userData locally
        storeUserState(user.db, user);

        user.orderTabData[baseToken] = user.orderTabData[baseToken].map(
          (tab) => {
            if (tab.tab_header.pub_key == tabAddress) {
              tab.base_amount += isAdd ? baseAmount : -baseAmount;
              tab.quote_amount += isAdd ? quoteAmount : -quoteAmount;

              return tab;
            }
          }
        );

        if (!isAdd) {
          let baseReturnNote = Note.fromGrpcObject(
            modifyTabResponse.base_return_note
          );
          let quoteReturnNote = Note.fromGrpcObject(
            modifyTabResponse.quote_return_note
          );

          if (!user.noteData[baseToken]) user.noteData[baseToken] = [];
          if (!user.noteData[quoteToken]) user.noteData[quoteToken] = [];
          user.noteData[baseToken].push(baseReturnNote);
          user.noteData[quoteToken].push(quoteReturnNote);
        }
      } else {
        let msg =
          "Failed to submit order with error: \n" +
          modifyTabResponse.error_message;
        console.log(msg);

        throw new Error(msg);
      }
    });
}

module.exports = {
  sendSpotOrder,
  sendBatchOrder,
  sendPerpOrder,
  sendCancelOrder,
  sendDeposit,
  sendWithdrawal,
  sendAmendOrder,
  sendSplitOrder,
  sendChangeMargin,
  sendLiquidationOrder,
  sendOpenOrderTab,
  sendCloseOrderTab,
  sendModifyOrderTab,
};

// // ========================

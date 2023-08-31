const { checkPerpOrderValidity } = require("../../helpers/orderHelpers");
const { trimHash } = require("../../transactions/stateStructs/Notes");

const axios = require("axios");

const {
  SERVER_URL,
  COLLATERAL_TOKEN,
  COLLATERAL_TOKEN_DECIMALS,
  DECIMALS_PER_ASSET,
  PRICE_DECIMALS_PER_ASSET,

  DUST_AMOUNT_PER_ASSET,
} = require("../../helpers/utils");
const { storeUserState } = require("../../helpers/localStorage");
const {
  handleLimitOrderResponse,
  handlePerpetualOrderResponse,
} = require("../handleOrderResponses");

const EXPRESS_APP_URL = `http://${SERVER_URL}:4000`; // process.env.EXPRESS_APP_URL;

//

async function _sendSpotOrderInner(
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

async function _sendPerpOrderInner(
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

async function _sendLiquidationOrderInner(
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

module.exports = {
  _sendSpotOrderInner,
  _sendPerpOrderInner,
  _sendLiquidationOrderInner,
};

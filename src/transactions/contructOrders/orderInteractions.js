const { getQtyFromQuote, getQuoteQty } = require("../../helpers/orderHelpers");
const { trimHash } = require("../../transactions/stateStructs/Notes");

const axios = require("axios");

const { SERVER_URL, COLLATERAL_TOKEN } = require("../../helpers/utils");
const {
  handleCancelOrderResponse,
  handleAmendOrderResponse,
} = require("../handleOrderResponses");

const EXPRESS_APP_URL = `http://${SERVER_URL}:4000`; // process.env.EXPRESS_APP_URL;

async function _sendCancelOrderInner(
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

async function _sendAmendOrderInner(
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

module.exports = {
  _sendCancelOrderInner,
  _sendAmendOrderInner,
};

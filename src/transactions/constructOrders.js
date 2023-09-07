const axios = require("axios");

const {
  SERVER_URL,
  COLLATERAL_TOKEN_DECIMALS,
  DECIMALS_PER_ASSET,
  PRICE_DECIMALS_PER_ASSET,
  SPOT_MARKET_IDS_2_TOKENS,
  PERP_MARKET_IDS_2_TOKENS,
} = require("../helpers/utils");

const {
  _sendWithdrawalInner,
  _sendDepositInner,
} = require("./contructOrders/onChainInteractions");
const {
  _sendSplitOrderInner,
  _sendChangeMarginInner,
} = require("./contructOrders/notePositionHelpers");
const {
  _sendSpotOrderInner,
  _sendPerpOrderInner,
  _sendLiquidationOrderInner,
} = require("./contructOrders/orderExecutions");
const {
  _sendAmendOrderInner,
  _sendCancelOrderInner,
} = require("./contructOrders/orderInteractions");
const {
  _sendOpenOrderTabInner,
  _sendModifyOrderTabInner,
} = require("./contructOrders/orderTabs");
const { Note } = require("./stateStructs/Notes");
const { storeUserState } = require("../helpers/localStorage");
const { OrderTab } = require("./stateStructs/OrderTab");

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
  return await _sendSpotOrderInner(
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
  );
}

// * =====================================================================================================================================
// * =====================================================================================================================================
// * =====================================================================================================================================

/**
 * This constructs a perpetual swap and sends it to the backend
 * ## Params:
 * @param  order_side "Long"/"Short"
 * @param  expirationTime expiration time in seconds
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
  return await _sendPerpOrderInner(
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
  );
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
  return await _sendLiquidationOrderInner(
    user,
    position,
    price,
    syntheticToken,
    syntheticAmount,
    initial_margin,
    slippage
  );
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
  return await _sendCancelOrderInner(
    user,
    orderId,
    orderSide,
    isPerp,
    marketId,
    errorCounter,
    dontUpdateState
  );
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
  return await _sendAmendOrderInner(
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
  );
}

// * =====================================================================================================================================

async function sendDeposit(user, depositId, amount, token, pubKey) {
  return await _sendDepositInner(user, depositId, amount, token, pubKey);
}

// * ======================================================================

async function sendWithdrawal(user, amount, token, starkKey) {
  return await _sendWithdrawalInner(user, amount, token, starkKey);
}

// * ======================================================================

/**
 * Restructures notes to have new amounts. This is useful if you don't want to wait for an order to be filled before you receive a refund.
 * ## Params:
 * @param token - token to restructure notes for
 * @param newAmounts - array of new amounts
 */
async function sendSplitOrder(user, token, newAmount) {
  return await _sendSplitOrderInner(user, token, newAmount);
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
  return await  _sendChangeMarginInner(
    user,
    positionAddress,
    syntheticToken,
    amount,
    direction
  );
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
  return await _sendOpenOrderTabInner(user, baseAmount, quoteAmount, marketId);
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
  return await _sendCloseOrderTabInner(user, marketId, tabAddress);
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
  return await _sendModifyOrderTabInner(
    user,
    isAdd,
    baseAmount,
    quoteAmount,
    tabAddress,
    marketId
  );
}

// * ======================================================================

/**
 * Sends a request to open an order tab
 * ## Params:
 * @param vlpToken
 * @param maxVlpSupply
 * @param posTabAddress
 * @param isPerp
 * @param marketId  determines which market (base/quote token) to use
 */
async function sendRegisterMm(
  user,
  vlpToken,
  maxVlpSupply,
  posTabAddress,
  isPerp,
  marketId
) {
  let baseAsset = isPerp
    ? PERP_MARKET_IDS_2_TOKENS[marketId]
    : SPOT_MARKET_IDS_2_TOKENS[marketId].base;

  maxVlpSupply = maxVlpSupply * 10 ** COLLATERAL_TOKEN_DECIMALS;

  let grpcMessage = user.onchainRegisterMM(
    baseAsset,
    vlpToken,
    maxVlpSupply,
    posTabAddress,
    isPerp,
    marketId
  );

  // console.log("grpcMessage", grpcMessage);

  await axios
    .post(`${EXPRESS_APP_URL}/onchain_register_mm`, grpcMessage)
    .then((res) => {
      let registerMMResponse = res.data.response;

      if (registerMMResponse.successful) {
        // ? Store the userData locally
        storeUserState(user.db, user);

        if (registerMMResponse.position) {
          if (!user.positionData[baseAsset]) user.positionData[baseAsset] = [];
          user.positionData[baseAsset].push(registerMMResponse.position);
        }

        if (registerMMResponse.order_tab) {
          let orderTab = OrderTab.fromGrpcObject(registerMMResponse.order_tab);

          if (!user.orderTabData[baseAsset]) user.orderTabData[baseAsset] = [];
          user.orderTabData[baseAsset].push(orderTab);
        }

        if (registerMMResponse.vlp_note) {
          let vlpNote = Note.fromGrpcObject(registerMMResponse.vlp_note);

          if (!user.noteData[vlpToken]) user.noteData[vlpToken] = [];
          user.noteData[vlpToken].push(vlpNote);
        }
      } else {
        let msg =
          "Failed to submit order with error: \n" +
          registerMMResponse.error_message;
        console.log(msg);

        throw new Error(msg);
      }
    });
}

//  * =======================================================================================================

/**
 * Sends a request to add liquidity to the order tab
 * ## Params:
 * @param posTabPubKey the public key of the position/tab
 * @param vLPToken  the vlp token of the tab
 * @param baseAmount  the amount of base token to supply (only if not isPerp)
 * @param quoteAmount the amount of quote token to supply (only if not isPerp)
 * @param collateralAmount the amount of collateral to supply (only if isPerp)
 * @param marketId
 * @param isPerp
 */
async function sendAddLiquidityUser(
  user,
  posTabPubKey,
  vLPToken,
  baseAmount,
  quoteAmount,
  collateralAmount,
  marketId,
  isPerp
) {
  if (isPerp) {
    collateralAmount = collateralAmount * 10 ** COLLATERAL_TOKEN_DECIMALS;
  } else {
    let baseToken = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
    let quoteToken = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

    baseAmount = baseAmount * 10 ** DECIMALS_PER_ASSET[baseToken];
    quoteAmount = quoteAmount * 10 ** DECIMALS_PER_ASSET[quoteToken];
  }

  let grpcMessage = user.addLiquidityMM(
    posTabPubKey,
    vLPToken,
    baseAmount,
    quoteAmount,
    collateralAmount,
    marketId,
    isPerp
  );

  storeUserState(user.db, user);

  // ? Send this to the marketMaker
  return grpcMessage;
}

async function sendOnChainAddLiquidityMM(user, grpcMessage) {
  let tabPubKey = grpcMessage.tab_pub_key;

  let tab_add_liquidity_req;
  let position_add_liquidity_req;
  let baseAsset;
  if (grpcMessage.pos_address) {
    // {
    //   collateral_notes_in,
    //   collateral_refund_note,
    //   pos_address,
    //   vlp_close_order_fields,
    //   signature,
    //   market_id,
    // }

    baseAsset = PERP_MARKET_IDS_2_TOKENS[grpcMessage.market_id];

    let position = user.positionData[baseAsset].find(
      (pos) =>
        pos.position_header.position_address.toString() ==
        grpcMessage.pos_address.toString()
    );

    position_add_liquidity_req = {
      collateral_notes_in: grpcMessage.collateral_notes_in,
      collateral_refund_note: grpcMessage.collateral_refund_note,
      position: position,
    };
  } else {
    // {
    //   base_notes_in,
    //   quote_notes_in,
    //   base_refund_note,
    //   quote_refund_note,
    //   tab_pub_key,
    //   vlp_close_order_fields,
    //   signature,
    //   market_id,
    // }

    baseAsset = SPOT_MARKET_IDS_2_TOKENS[grpcMessage.market_id].base;

    let order_tab = user.orderTabData[baseAsset].find(
      (tab) => tab.tab_header.pub_key.toString() == tabPubKey.toString()
    );

    tab_add_liquidity_req = {
      base_notes_in: grpcMessage.base_notes_in,
      quote_notes_in: grpcMessage.quote_notes_in,
      base_refund_note: grpcMessage.base_refund_note,
      quote_refund_note: grpcMessage.quote_refund_note,
      order_tab: order_tab.toGrpcObject(),
    };
  }

  let onChainAddLiqReq = {
    tab_add_liquidity_req,
    position_add_liquidity_req,
    vlp_close_order_fields: grpcMessage.vlp_close_order_fields,
    signature: grpcMessage.signature,
    market_id: grpcMessage.market_id,
    base_token: baseAsset,
  };

  // console.log("onChainAddLiqReq", onChainAddLiqReq);

  await axios
    .post(`${EXPRESS_APP_URL}/add_liquidity_mm`, onChainAddLiqReq)
    .then((res) => {
      let registerMMResponse = res.data.response;

      console.log("registerMMResponse", registerMMResponse);

      if (registerMMResponse.successful) {
        // ? Store the userData locally
        storeUserState(user.db, user);

        if (registerMMResponse.position) {
          if (!user.positionData[baseAsset]) user.positionData[baseAsset] = [];
          user.positionData[baseAsset].push(registerMMResponse.position);
        }

        if (registerMMResponse.order_tab) {
          if (!user.orderTabData[baseAsset]) user.orderTabData[baseAsset] = [];
          user.orderTabData[baseAsset].push(registerMMResponse.order_tab);
        }

        if (registerMMResponse.vlp_note) {
          // TODO: This should be forwarded to the user
          // let vlpNote = Note.fromGrpcObject(registerMMResponse.vlp_note);
          // if (!user.noteData[vlpToken]) user.noteData[vlpToken] = [];
          // user.noteData[vlpToken].push(vlpNote);
        }
      } else {
        let msg =
          "Failed to submit order with error: \n" +
          registerMMResponse.error_message;
        console.log(msg);

        throw new Error(msg);
      }
    });
}

/**
 * Sends a request to add liquidity to the order tab
 * ## Params:
 * @param posTabPubKey the public key of the position/tab
 * @param vLPToken  the vlp token of the tab
 * @param indexPrice the index price you want the slippage to be calculated on (only if tab order)
 * @param slippage the slippage limit in percentage (1 = 1%) (null if limit) (only if tab order)
 * @param marketId
 * @param isPerp
 */
async function sendOnChainRemoveLiquidityUser(
  user,
  posTabPubKey,
  vlpToken,
  indexPrice,
  slippage,
  marketId,
  isPerp
) {
  if (!isPerp) {
    let baseToken = SPOT_MARKET_IDS_2_TOKENS[marketId].base;

    indexPrice = indexPrice * 10 ** PRICE_DECIMALS_PER_ASSET[baseToken];
    slippage = slippage * 100; // slippage: 10_000 = 100% ; 100 = 1%; 1 = 0.01%
  }

  let grpcMessage = user.removeLiquidityMM(
    posTabPubKey,
    vlpToken,
    indexPrice,
    slippage,
    marketId,
    isPerp
  );

  storeUserState(user.db, user);

  // ? Send this to the marketMaker
  return grpcMessage;
}

async function sendOnChainRemoveLiquidityMM(user, grpcMessage) {
  //

  let isPerp = !!grpcMessage.position_pub_key;

  let tab_remove_liquidity_req;
  let position_remove_liquidity_req;
  let baseAsset;
  if (isPerp) {
    // {
    //   vlp_notes_in,
    //   collateral_close_order_fields,
    //   position_pub_key,
    //   signature,
    //   market_id,
    // }

    baseAsset = PERP_MARKET_IDS_2_TOKENS[grpcMessage.market_id];

    let position = user.positionData[baseAsset].find(
      (pos) =>
        pos.position_header.position_address.toString() ==
        grpcMessage.position_pub_key.toString()
    );

    position_remove_liquidity_req = {
      collateral_close_order_fields: grpcMessage.collateral_close_order_fields,
      position: position,
    };
  } else {
    // {
    //   vlp_notes_in,
    //   index_price,
    //   slippage,
    //   base_close_order_fields,
    //   quote_close_order_fields,
    //   tab_pub_key,
    //   signature,
    //   market_id,
    // }

    baseAsset = SPOT_MARKET_IDS_2_TOKENS[grpcMessage.market_id].base;

    let tabPubKey = grpcMessage.tab_pub_key;

    let order_tab = user.orderTabData[baseAsset].find(
      (tab) => tab.tab_header.pub_key.toString() == tabPubKey.toString()
    );

    let vlpAmount = grpcMessage.vlp_notes_in.reduce(
      (acc, note) => acc + note.amount,
      0
    );
    let vlpSupply = order_tab.vlp_supply;

    let baseDecimals = DECIMALS_PER_ASSET[order_tab.tab_header.base_token];
    let basePriceDecimals =
      PRICE_DECIMALS_PER_ASSET[order_tab.tab_header.base_token];

    let baseAmount = order_tab.base_amount / 10 ** baseDecimals;
    let indexPrice = grpcMessage.index_price / 10 ** basePriceDecimals;
    let quoteAmount = order_tab.quote_amount / 10 ** COLLATERAL_TOKEN_DECIMALS;

    let tabNominal = baseAmount * indexPrice + quoteAmount;

    let base_return_amount =
      (vlpAmount * tabNominal) / (2 * vlpSupply * indexPrice);
    base_return_amount = base_return_amount * 10 ** baseDecimals;

    tab_remove_liquidity_req = {
      base_close_order_fields: grpcMessage.base_close_order_fields,
      quote_close_order_fields: grpcMessage.quote_close_order_fields,
      order_tab: order_tab.toGrpcObject(),
      base_return_amount,
      index_price: grpcMessage.index_price,
      slippage: grpcMessage.slippage,
    };
  }

  let removeLiqReq = {
    vlp_notes_in: grpcMessage.vlp_notes_in,
    base_token: baseAsset,
    tab_remove_liquidity_req,
    position_remove_liquidity_req,
    signature: grpcMessage.signature,
    market_id: grpcMessage.market_id,
  };

  // console.log("removeLiqReq", removeLiqReq);

  await axios
    .post(`${EXPRESS_APP_URL}/remove_liquidity_mm`, removeLiqReq)
    .then((res) => {
      let registerMMResponse = res.data.response;

      if (registerMMResponse.successful) {
        console.log("registerMMResponse", registerMMResponse);

        // ? Store the userData locally
        storeUserState(user.db, user);

        if (registerMMResponse.tab_res) {
          if (!user.orderTabData[baseAsset]) user.orderTabData[baseAsset] = [];
          user.orderTabData[baseAsset].push(registerMMResponse.order_tab);

          // Todo: This should be forwarded to the user
          // let baseReturnNote = Note.fromGrpcObject(registerMMResponse.base_return_note);
          // let quoteReturnNote = Note.fromGrpcObject(registerMMResponse.quote_return_note);
        }
        if (registerMMResponse.position_res) {
          if (!user.positionData[baseAsset]) user.positionData[baseAsset] = [];
          user.positionData[baseAsset].push(registerMMResponse.position);

          // Todo: This should be forwarded to the user
          // let collateralNote = Note.fromGrpcObject(registerMMResponse.collateral_note);
        }
      } else {
        let msg =
          "Failed to submit order with error: \n" +
          registerMMResponse.error_message;
        console.log(msg);

        throw new Error(msg);
      }
    });
}

module.exports = {
  sendSpotOrder,
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
  sendRegisterMm,
  sendAddLiquidityUser,
  sendOnChainAddLiquidityMM,
  sendOnChainRemoveLiquidityUser,
  sendOnChainRemoveLiquidityMM,
};

// // ========================

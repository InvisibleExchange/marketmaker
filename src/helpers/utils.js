const axios = require("axios");
const UserState = require("../users/Invisibl3User").default;
const { Note, trimHash } = require("../transactions/stateStructs/Notes");

const SERVER_URL = "localhost";
// const SERVER_URL = "54.212.28.196";

const EXCHANGE_CONFIG = require("../../exchange-config.json");

const SYMBOLS_TO_IDS = EXCHANGE_CONFIG["SYMBOLS_TO_IDS"];
const IDS_TO_SYMBOLS = EXCHANGE_CONFIG["IDS_TO_SYMBOLS"];

const CHAIN_IDS = EXCHANGE_CONFIG["CHAIN_IDS"];

const DECIMALS_PER_ASSET = EXCHANGE_CONFIG["DECIMALS_PER_ASSET"];

const PRICE_DECIMALS_PER_ASSET = EXCHANGE_CONFIG["PRICE_DECIMALS_PER_ASSET"];

const DUST_AMOUNT_PER_ASSET = EXCHANGE_CONFIG["DUST_AMOUNT_PER_ASSET"];

const LEVERAGE_DECIMALS = EXCHANGE_CONFIG["LEVERAGE_DECIMALS"];
const COLLATERAL_TOKEN_DECIMALS = EXCHANGE_CONFIG["COLLATERAL_TOKEN_DECIMALS"];
const COLLATERAL_TOKEN = EXCHANGE_CONFIG["COLLATERAL_TOKEN"];

const MAX_LEVERAGE = EXCHANGE_CONFIG["MAX_LEVERAGE"];

const SPOT_MARKET_IDS = EXCHANGE_CONFIG["SPOT_MARKET_IDS"];

const PERP_MARKET_IDS = EXCHANGE_CONFIG["PERP_MARKET_IDS"];

const SPOT_MARKET_IDS_2_TOKENS = EXCHANGE_CONFIG["SPOT_MARKET_IDS_2_TOKENS"];

const PERP_MARKET_IDS_2_TOKENS = EXCHANGE_CONFIG["PERP_MARKET_IDS_2_TOKENS"];

const EXPRESS_APP_URL = `http://${SERVER_URL}:4000`;

function get_max_leverage(token, amount) {
  let [min_bound, max_bound] = LEVERAGE_BOUNDS_PER_ASSET[token];

  let maxLev;
  if (amount < min_bound) {
    maxLev = MAX_LEVERAGE;
  } else if (amount < max_bound) {
    // b. For trades between $100,000 and $1,000,000, reduce the maximum leverage proportionally, such as 50 * ($100,000/$trade size).

    maxLev = MAX_LEVERAGE * (min_bound / amount);
  } else {
    maxLev = 1;
  }

  return maxLev;
}

/**
 * gets the order book entries for a given market
 * ## Params:
 * @param  token
 * @param  isPerp if is perpetual market
 * ## Returns:
 * @return {} {bid_queue, ask_queue}  queue structure= [price, size, timestamp]
 */
async function fetchLiquidity(token, isPerp) {
  let marketId = isPerp ? PERP_MARKET_IDS[token] : SPOT_MARKET_IDS[token];

  return await axios
    .post(`${EXPRESS_APP_URL}/get_liquidity`, {
      market_id: marketId,
      is_perp: isPerp,
    })
    .then((res) => {
      let liquidity_response = res.data.response;

      if (liquidity_response.successful) {
        let bidQueue = liquidity_response.bid_queue;
        let askQueue = liquidity_response.ask_queue;

        return { bidQueue, askQueue };
      } else {
        let msg =
          "Getting liquidity failed with error: \n" +
          liquidity_response.error_message;
        throw new Error(msg);
      }
    });
}

// Also a websocket to listen to orderbook updates
// let W3CWebSocket = require("websocket").w3cwebsocket;
// client = new W3CWebSocket("ws://localhost:50053/");

// client.onopen = function () {
//   client.send(trimHash(user.userId, 64));
// };

// client.onmessage = function (e) {
//   let msg = JSON.parse(e.data);

// MESSAGE OPTIONS:

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
// "swap_response": responseObject,
// -> handleSwapResult(user, responseObject)

function handleLiquidityUpdate(
  result,
  liquidity,
  setLiquidity,
  perpLiquidity,
  setPerpLiquidity
) {
  for (let update of result.liquidity_updates) {
    let askQueue = update.ask_liquidity.map((item) => {
      return {
        price: item[0],
        amount: item[1],
        timestamp: item[2],
      };
    });
    let revAq = [];
    for (let i = askQueue.length - 1; i >= 0; i--) {
      revAq.push(askQueue[i]);
    }

    let bidQueue = update.bid_liquidity.map((item) => {
      return {
        price: item[0],
        amount: item[1],
        timestamp: item[2],
      };
    });

    let pairLiquidity = { bidQueue, askQueue: revAq };

    if (update.type === "perpetual") {
      let token = PERP_MARKET_IDS_2_TOKENS[update.market];

      perpLiquidity[token] = pairLiquidity;
      setPerpLiquidity(perpLiquidity);
    } else {
      let token = SPOT_MARKET_IDS_2_TOKENS[update.market].base;

      liquidity[token] = pairLiquidity;
      setLiquidity(liquidity);
    }
  }
}

/**
 * Handles the result received from the backend after a swap executed.
 * @param  result  The result structure is:
 *  result format:
 *   {
 *          type: "perpetual"/"spot"
 *          asset: u64
 *          amount: u64
 *          price: u64
 *          is_buy: bool
 *          timestamp: u64
 *   }
 */
function handleFillResult(user, result, fills, setFills) {
  let _fills = fills[result.asset] ? [...fills[result.asset]] : [];
  _fills.unshift({
    amount: result.amount,
    price: result.price,
    base_token: result.asset,
    is_buy: result.is_buy,
    timestamp: result.timestamp,
    isPerp: result.type == "perpetual",
  });

  if (_fills.length > 15) {
    _fills.pop();
  }

  fills[result.asset] = _fills;

  setFills(fills);

  let trimedId = trimHash(user.userId, 64).toString();

  if (result.user_id_a == trimedId || result.user_id_b == trimedId) {
    let fill = {
      amount: result.amount,
      price: result.price,
      base_token: result.asset,
      side: result.user_id_a == trimedId ? "Buy" : "Sell",
      time: result.timestamp,
      isPerp: result.type == "perpetual",
    };

    user.fills.unshift(fill);
  }
}

/**
 * Handles the result received from the backend after a swap executed.
 * @param  result  The result structure is:
 *  result format:
 *   {
 *          swap_note: Note
 *          new_pfr_note: Note or null,
 *          new_amount_filled: u64,
 *          fee_taken: u64,
 *   }
 */
function handleSwapResult(
  user,
  orderId,
  spent_amount,
  received_amount,
  swap_response,
  marketId,
  ACTIVE_ORDERS
) {
  //

  if (swap_response) {
    let swapNoteObject = swap_response.swap_note;
    let swapNote = Note.fromGrpcObject(swapNoteObject);
    if (user.noteData[swapNote.token]) {
      user.noteData[swapNote.token].push(swapNote);
    } else {
      user.noteData[swapNote.token] = [swapNote];
    }

    if (user.refundNotes[orderId]) {
      if (
        swap_response.swap_note.amount ==
        swap_response.new_amount_filled - swap_response.fee_taken
      ) {
        // This is a limit first fill order and the refun note has been stored, then we can
        // add the refund note to the noteData
        let refund_note = user.refundNotes[orderId];

        if (user.noteData[refund_note.token]) {
          user.noteData[refund_note.token].push(refund_note);
        } else {
          user.noteData[refund_note.token] = [refund_note];
        }
      }
    }
  }

  let idx = user.orders.findIndex((o) => o.order_id == orderId);
  let order = user.orders[idx];
  if (order) {
    let baseToken = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
    let side = order.token_spent == baseToken ? "Sell" : "Buy";

    // ? Update the Order tab
    if (order.order_tab) {
      let tabAddress = order.order_tab.tab_header.pub_key;

      // ? Get the order tab
      let orderTab;
      if (user.orderTabData[baseToken].length > 0) {
        for (let tab of user.orderTabData[baseToken]) {
          if (tab.tab_header.pub_key == tabAddress) {
            orderTab = tab;
            break;
          }
        }
      }

      if (orderTab) {
        if (side == "Buy") {
          orderTab.base_amount += Number.parseInt(received_amount);
          orderTab.quote_amount -= Number.parseInt(spent_amount);
        } else {
          orderTab.base_amount -= Number.parseInt(spent_amount);
          orderTab.quote_amount += Number.parseInt(received_amount);
        }
      }
    }

    // ? REMOVE THE ORDER FROM ACTIVE_ORDERS IF NECESSARY
    if (ACTIVE_ORDERS) {
      let idx2 = ACTIVE_ORDERS[marketId.toString() + side].findIndex(
        (o) => o.id == orderId
      );

      if (idx2 != -1) {
        let activeOrder = ACTIVE_ORDERS[marketId.toString() + side][idx2];

        activeOrder.spendAmount -= Number.parseInt(spent_amount);

        if (
          activeOrder.spendAmount <= DUST_AMOUNT_PER_ASSET[order.token_spent]
        ) {
          ACTIVE_ORDERS[marketId.toString() + side].splice(idx2, 1);
        }
      }
    }

    // Remove the order from the active orders if necessary
    order.qty_left -= received_amount;
    if (order.qty_left < DUST_AMOUNT_PER_ASSET[order.token_received]) {
      user.orders.splice(idx, 1);
    } else {
      user.orders[idx] = order;
    }
  }
  user.filledAmounts[orderId] += received_amount;
}

/**
 * Handles the result received from the backend after a perpetual swap executed.
 * @param  result  The result structure is:
 *  result format:
 *
 *
 *   {
 *       position: PerpPosition/null,
 *       new_pfr_info: [Note/null, u64,u64]>,
 *       return_collateral_note: Note/null,
 *       synthetic_token: u64,
 *       qty: u64,
 *       fee_taken: u64,
 *    }
 */
function handlePerpSwapResult(
  user,
  orderId,
  swap_response,
  marketId,
  ACTIVE_ORDERS
) {
  //

  // ? Save position data (if not null)
  let position = swap_response.position;

  if (position) {
    if (
      !user.positionData[position.position_header.synthetic_token] ||
      user.positionData[position.position_header.synthetic_token].length == 0
    ) {
      user.positionData[position.position_header.synthetic_token] = [position];
    } else {
      // check if positions with this address and index already exist
      let idx = user.positionData[
        position.position_header.synthetic_token
      ].findIndex(
        (p) =>
          p.position_header.position_address ==
            position.position_header.position_address &&
          p.index == position.index
      );

      if (idx >= 0) {
        user.positionData[position.position_header.synthetic_token][idx] =
          position;
      } else {
        user.positionData[position.position_header.synthetic_token].push(
          position
        );
      }
    }
  }

  // // ? Save partiall fill note (if not null)
  // let newPfrInfo = swap_response.new_pfr_info;
  // if (newPfrInfo && newPfrInfo[0]) {
  //   let newPfrNote = Note.fromGrpcObject(newPfrInfo[0]);
  //   user.pfrNotes.push(newPfrNote);
  // }

  // ? Save return collateral note (if not null)
  let returnCollateralNote = swap_response.return_collateral_note;
  if (returnCollateralNote) {
    let returnCollateralNoteObject = Note.fromGrpcObject(returnCollateralNote);
    if (user.noteData[returnCollateralNoteObject.token]) {
      user.noteData[returnCollateralNoteObject.token].push(
        returnCollateralNoteObject
      );
    } else {
      user.noteData[returnCollateralNoteObject.token] = [
        returnCollateralNoteObject,
      ];
    }

    if (!position) {
      // filter out the position that has synthetic_amount == qty
      let idx = user.positionData[swap_response.synthetic_token].findIndex(
        (p) =>
          Math.abs(p.position_size - swap_response.qty) <
          DUST_AMOUNT_PER_ASSET[swap_response.synthetic_token]
      );

      if (idx >= 0) {
        user.positionData[swap_response.synthetic_token].splice(idx, 1);
      }
    }
  }

  if (user.refundNotes[orderId]) {
    if (
      swap_response.new_pfr_info[1] ==
      swap_response.qty - swap_response.fee_taken
    ) {
      // this is a limit order and the refun note has been stored, then we can
      // add the refund note to the noteData
      let refund_note = user.refundNotes[orderId];

      if (user.noteData[refund_note.token]) {
        user.noteData[refund_note.token].push(refund_note);
      } else {
        user.noteData[refund_note.token] = [refund_note];
      }
    }
  }

  let idx = user.perpetualOrders.findIndex((o) => o.order_id == orderId);
  let order = user.perpetualOrders[idx];

  if (order) {
    order.qty_left =
      order.qty_left - swap_response.qty - swap_response.fee_taken;

    if (order.qty_left < DUST_AMOUNT_PER_ASSET[swap_response.synthetic_token]) {
      // ? Remove the order from ACTIVE_ORDERS
      if (ACTIVE_ORDERS) {
        ACTIVE_ORDERS[marketId.toString() + "Buy"] = ACTIVE_ORDERS[
          marketId.toString() + "Buy"
        ].filter((o) => o.id != orderId);
        ACTIVE_ORDERS[marketId.toString() + "Sell"] = ACTIVE_ORDERS[
          marketId.toString() + "Sell"
        ].filter((o) => o.id != orderId);
      }

      // ? remove the order from users orders
      user.perpetualOrders.splice(idx, 1);
    } else {
      user.perpetualOrders[idx] = order;
    }
  }

  user.filledAmounts[orderId] = swap_response.new_pfr_info[1];
}

/**
 * Handles the result received from the backend after a note split(restructuring)
 * Removes the previous notes and adds the new notes to the user's noteData and database.
 * @param  zero_idxs  The indexes of new notes
 */
function handleNoteSplit(user, zero_idxs, notesIn, notesOut) {
  //

  // for (const noteIn of notesIn) {
  //   user.noteData[noteIn.token] = user.noteData[noteIn.token].filter(
  //     (n) => n.index != noteIn.index
  //   );
  // }

  for (let i = 0; i < zero_idxs.length; i++) {
    let note = notesOut[i];
    note.index = zero_idxs[i];
    // storeNewNote(note);
    user.noteData[note.token].push(note);
  }
}

//

//

//

/**
 * This ask the user to sign a message to login. The signature is used to derive the private key
 * and use it to login and fetch all the user's data.
 * @param  signer  ethers.js signer
 */
async function loginUser(signer) {
  const keyDerivation =
    require("@starkware-industries/starkware-crypto-utils").keyDerivation;

  let sig = await signer.signMessage(
    "Sign this message to access your Invisibl3 account. \nIMPORTANT: Only sign this message on Invisible.com!!"
  );

  let pk = keyDerivation.getPrivateKeyFromEthSignature(sig);

  let user = UserState.fromPrivKey(pk);

  let { emptyPrivKeys, emptyPositionPrivKeys, emptyTabPrivKeys } =
    await user.login();

  let { badOrderIds, orders, badPerpOrderIds, perpOrders, pfrNotes } =
    await getActiveOrders(user.orderIds, user.perpetualOrderIds);

  await user.handleActiveOrders(
    badOrderIds,
    orders,
    badPerpOrderIds,
    perpOrders,
    pfrNotes,
    emptyPrivKeys,
    emptyPositionPrivKeys
  );

  return user;
}

async function getActiveOrders(order_ids, perp_order_ids) {
  return await axios
    .post(`${EXPRESS_APP_URL}/get_orders`, { order_ids, perp_order_ids })
    .then((res) => {
      let order_response = res.data.response;

      let badOrderIds = order_response.bad_order_ids;
      let orders = order_response.orders;
      let badPerpOrderIds = order_response.bad_perp_order_ids;
      let perpOrders = order_response.perp_orders;
      let pfrNotes = order_response.pfr_notes
        ? order_response.pfr_notes.map((n) => Note.fromGrpcObject(n))
        : [];

      return { badOrderIds, orders, badPerpOrderIds, perpOrders, pfrNotes };
    })
    .catch((err) => {
      console.log(err);
      throw err;
    });
}

//

//

//

//

//

module.exports = {
  SERVER_URL,
  DECIMALS_PER_ASSET,
  PRICE_DECIMALS_PER_ASSET,
  DUST_AMOUNT_PER_ASSET,
  LEVERAGE_DECIMALS,
  COLLATERAL_TOKEN_DECIMALS,
  COLLATERAL_TOKEN,
  get_max_leverage,
  MAX_LEVERAGE,
  handleSwapResult,
  handlePerpSwapResult,
  handleNoteSplit,
  handleFillResult,
  handleLiquidityUpdate,
  getActiveOrders,
  fetchLiquidity,
  loginUser,
  SYMBOLS_TO_IDS,
  IDS_TO_SYMBOLS,
  CHAIN_IDS,
  PERP_MARKET_IDS,
  SPOT_MARKET_IDS,
  SPOT_MARKET_IDS_2_TOKENS,
  PERP_MARKET_IDS_2_TOKENS,
};

//

//

//

//

//

const {
  DUST_AMOUNT_PER_ASSET,
  SPOT_MARKET_IDS,
  PERP_MARKET_IDS,
} = require("../helpers/utils");
const { Note } = require("../users/Notes");

function handleLimitOrderResponse(
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
) {
  // If this is a taker order it might have been filled fully/partially before the response was received (here)
  let filledAmount = user.filledAmounts[order_response.order_id]
    ? user.filledAmounts[order_response.order_id]
    : 0;

  // ? Add the refund note
  if (limitOrder.spot_note_info && limitOrder.spot_note_info.refund_note) {
    if (filledAmount > 0) {
      // If this is a market order then we can add the refund note immediately
      user.noteData[limitOrder.spot_note_info.refund_note.token].push(
        limitOrder.spot_note_info.refund_note
      );
    } else {
      // If this is a limit order then we need to wait for the order to be filled
      // (untill we receive a response through the websocket)
      user.refundNotes[order_response.order_id] =
        limitOrder.spot_note_info.refund_note;
    }
  }

  if (
    filledAmount < receiveAmount - DUST_AMOUNT_PER_ASSET[receiveToken] &&
    !isMarket
  ) {
    // If the order has not been fully filled already and is not a market order

    limitOrder.order_id = order_response.order_id;
    user.orders.push(limitOrder);

    if (
      ACTIVE_ORDERS[
        SPOT_MARKET_IDS[baseToken].toString() + order_side.toString()
      ]
    ) {
      ACTIVE_ORDERS[
        SPOT_MARKET_IDS[baseToken].toString() + order_side.toString()
      ].push({
        id: order_response.order_id,
        spendAmount: spendAmount,
        price,
      });
    } else {
      ACTIVE_ORDERS[
        SPOT_MARKET_IDS[baseToken].toString() + order_side.toString()
      ] = [
        {
          id: order_response.order_id,
          spendAmount: spendAmount,
          price,
        },
      ];
    }
  }
}

// *  ========================================================================

function handleBatchOrderResponse(
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
) {
  // If this is a taker order it might have been filled fully/partially before the response was received (here)
  let filledAmount = user.filledAmounts[order_response.order_id]
    ? user.filledAmounts[order_response.order_id]
    : 0;

  // ? Add the refund note
  if (limitOrder.refund_note) {
    if (filledAmount > 0) {
      // If this is a market order then we can add the refund note immediately
      user.noteData[limitOrder.refund_note.token].push(limitOrder.refund_note);
    } else {
      // If this is a limit order then we need to wait for the order to be filled
      // (untill we receive a response through the websocket)
      user.refundNotes[order_response.order_id] = limitOrder.refund_note;
    }
  }

  if (filledAmount < receiveAmount - DUST_AMOUNT_PER_ASSET[receiveToken]) {
    let order_id = Number(order_response.order_id);

    for (let i = 0; i < spendAmounts.length; i++) {
      let amount = spendAmounts[i];
      let price = prices[i];

      if (
        ACTIVE_ORDERS[
          SPOT_MARKET_IDS[baseToken].toString() + order_side.toString()
        ]
      ) {
        ACTIVE_ORDERS[
          SPOT_MARKET_IDS[baseToken].toString() + order_side.toString()
        ].push({
          id: order_id,
          spendAmount: amount,
          price,
        });
      } else {
        ACTIVE_ORDERS[
          SPOT_MARKET_IDS[baseToken].toString() + order_side.toString()
        ] = [
          {
            id: order_id,
            spendAmount: amount,
            price,
          },
        ];
      }
    }

    limitOrder.order_id = order_id;
    user.orders.push(limitOrder);
  }
}

// *  ========================================================================

function handlePerpetualOrderResponse(
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
) {
  // If this is a taker order it might have been filled fully/partially before the response was received (here)
  let filledAmount = user.filledAmounts[order_response.order_id]
    ? user.filledAmounts[order_response.order_id]
    : 0;

  // ? Add the refund note
  let refundNote =
    orderJson.position_effect_type == 0 &&
    perpOrder.open_order_fields.refund_note
      ? perpOrder.open_order_fields.refund_note
      : null;
  if (refundNote) {
    if (filledAmount > 0) {
      // If this is a market order then we can add the refund note immediately
      user.noteData[refundNote.token].push(refundNote);
    } else {
      // If this is a limit order then we need to wait for the order to be filled
      // (untill we receive a response through the websocket)

      user.refundNotes[order_response.order_id] = refundNote;
    }
  }

  if (
    filledAmount <
      syntheticAmount - DUST_AMOUNT_PER_ASSET[perpOrder.synthetic_token] &&
    !isMarket
  ) {
    perpOrder.order_id = order_response.order_id;

    user.perpetualOrders.push(perpOrder);

    let side = order_side == "Long" ? "Buy" : "Sell";
    if (
      ACTIVE_ORDERS[
        PERP_MARKET_IDS[perpOrder.synthetic_token].toString() + side.toString()
      ]
    ) {
      ACTIVE_ORDERS[
        PERP_MARKET_IDS[perpOrder.synthetic_token].toString() + side.toString()
      ].push({
        id: order_response.order_id,
        syntheticAmount: syntheticAmount_,
        price,
      });
    } else {
      ACTIVE_ORDERS[
        PERP_MARKET_IDS[perpOrder.synthetic_token].toString() + side.toString()
      ] = [
        {
          id: order_response.order_id,
          syntheticAmount: syntheticAmount_,
          price,
        },
      ];
    }
  }
}

// *  ========================================================================

function handleCancelOrderResponse(user, order_response, orderId, isPerp) {
  let pfrNote = order_response.pfr_note;
  if (pfrNote) {
    // This means that the order has been filled partially
    // so we need don't need to add the notesIn to the user's noteData
    // instead we add the pfrNote to the user's noteData

    let note = Note.fromGrpcObject(pfrNote);
    let exists = false;
    for (let n of user.noteData[pfrNote.token]) {
      if (
        n.address.getX().toString() == note.address.getX().toString() &&
        n.index == note.index
      ) {
        exists = true;
      }
    }
    if (!exists) {
      user.noteData[pfrNote.token].push(note);
    }

    if (isPerp) {
      // loop over the user's perpetual orders and find the order that has been cancelledž
      user.perpetualOrders = user.perpetualOrders.filter(
        (o) => o.order_id != orderId
      );
    } else {
      // loop over the user's spot orders and find the order that has been cancelled
      user.orders = user.orders.filter((o) => o.order_id != orderId);
    }
  } else {
    // This means that the order has not been filled partially yet
    // so we need to add the notesIn to the user's noteData

    if (isPerp) {
      for (let i = 0; i < user.perpetualOrders.length; i++) {
        // loop over the user's perpetual orders and find the order that has been cancelled
        // if notesIn is not empty (open order) then add the notes to the user's noteData

        let ord = user.perpetualOrders[i];
        if (ord.order_id == orderId.toString()) {
          let notes_in = ord.notes_in;
          if (notes_in && notes_in.length > 0) {
            for (let note_ of notes_in) {
              let note = Note.fromGrpcObject(note_);
              user.noteData[note.token].push(note);
            }
          }
        }
      }

      user.perpetualOrders = user.perpetualOrders.filter(
        (o) => o.order_id != orderId
      );
    } else {
      // loop over the user's spot orders and find the order that has been cancelled
      // if notesIn is not empty then add the notes to the user's noteData

      for (let i = 0; i < user.orders.length; i++) {
        let ord = user.orders[i];

        if (ord.order_id == orderId && ord.spot_note_info) {
          let notes_in = ord.spot_note_info.notes_in;
          if (notes_in.length > 0) {
            for (let note_ of notes_in) {
              let note = Note.fromGrpcObject(note_);

              let exists = false;
              for (let n of user.noteData[note.token]) {
                if (
                  n.address.getX().toString() ==
                    note.address.getX().toString() &&
                  n.index == note.index
                ) {
                  exists = true;
                }
              }
              if (!exists) {
                user.noteData[note.token].push(note);
              }
            }
          }
        }
      }

      user.orders = user.orders.filter((o) => o.order_id != orderId);
    }
  }
}

// *  ========================================================================

function handleAmendOrderResponse(user, isPerp, order, orderId) {
  if (isPerp) {
    for (let i = 0; i < user.perpetualOrders.length; i++) {
      let ord = user.perpetualOrders[i];

      if (ord.order_id == orderId.toString()) {
        user.perpetualOrders[i] = order;
      }
    }
  } else {
    for (let i = 0; i < user.orders.length; i++) {
      let ord = user.orders[i];

      if (ord.order_id == orderId.toString()) {
        user.orders[i] = order;
      }
    }
  }
}

// *  ========================================================================

function handleDepositResponse(user, deposit_response, deposit) {
  let zero_idxs = deposit_response.zero_idxs;

  for (let i = 0; i < zero_idxs.length; i++) {
    const idx = zero_idxs[i];
    let note = deposit.notes[i];
    note.index = idx;
    // storeNewNote(note)

    if (!user.noteData[note.token]) {
      user.noteData[note.token] = [note];
    } else {
      user.noteData[note.token].push(note);
    }
  }
}

// *  ========================================================================

function handleMarginChangeResponse(
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
) {
  if (direction == "Add") {
    for (let i = 0; i < notes_in.length; i++) {
      let note = notes_in[i];
      user.noteData[note.token] = user.noteData[note.token].filter(
        (n) => n.index != note.index
      );
    }

    if (refund_note) {
      user.noteData[refund_note.token].push(refund_note);
    }
  } else {
    // dest_received_address: any, dest_received_blinding
    let returnCollateralNote = new Note(
      close_order_fields.dest_received_address,
      position.collateral_token,
      margin_change,
      close_order_fields.dest_received_blinding,
      marginChangeResponse.return_collateral_index
    );
    // storeNewNote(returnCollateralNote);
    user.noteData[position.collateral_token].push(returnCollateralNote);
  }

  // Update the user's position data
  user.positionData[syntheticToken] = user.positionData[syntheticToken].map(
    (pos) => {
      if (pos.position_header.position_address == positionAddress) {
        pos.margin += direction == "Add" ? margin_change : -margin_change;

        let bankruptcyPrice = _getBankruptcyPrice(
          pos.entry_price,
          pos.margin,
          pos.position_size,
          pos.order_side,
          pos.position_header.synthetic_token
        );

        let liquidationPrice = _getLiquidationPrice(
          pos.entry_price,
          pos.margin,
          pos.position_size,
          pos.order_side,
          pos.position_header.synthetic_token,
          pos.position_header.allow_partial_liquidations
        );

        pos.bankruptcy_price = bankruptcyPrice;
        pos.liquidation_price = liquidationPrice;

        let hash = computeHashOnElements([
          pos.order_side == "Long"
            ? pos.position_header.allow_partial_liquidations
              ? 3
              : 2
            : pos.position_header.allow_partial_liquidations
            ? 1
            : 0,
          pos.position_header.synthetic_token,
          pos.position_size,
          pos.entry_price,
          pos.liquidation_price,
          pos.position_header.position_address,
          pos.last_funding_idx,
        ]);

        pos.hash = hash.toString();

        return pos;
      } else {
        return pos;
      }
    }
  );
}

module.exports = {
  handleLimitOrderResponse,
  handleBatchOrderResponse,
  handlePerpetualOrderResponse,
  handleCancelOrderResponse,
  handleAmendOrderResponse,
  handleDepositResponse,
  handleMarginChangeResponse,
};

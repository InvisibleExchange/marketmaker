const axios = require("axios");

const {
  SERVER_URL,
  COLLATERAL_TOKEN_DECIMALS,
  DECIMALS_PER_ASSET,
  handleNoteSplit,
} = require("../../helpers/utils");
const { handleMarginChangeResponse } = require("../handleOrderResponses");

const EXPRESS_APP_URL = `http://${SERVER_URL}:4000`; // process.env.EXPRESS_APP_URL;

async function _sendSplitOrderInner(user, token, newAmount) {
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

async function _sendChangeMarginInner(
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

module.exports = {
  _sendSplitOrderInner,
  _sendChangeMarginInner,
};

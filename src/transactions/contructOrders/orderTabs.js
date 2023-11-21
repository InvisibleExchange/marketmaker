const axios = require("axios");

const { Note } = require("../../transactions/stateStructs/Notes");

const { SERVER_URL, SPOT_MARKET_IDS_2_TOKENS } = require("../../helpers/utils");
const { storeUserState } = require("../../helpers/localStorage");

const EXPRESS_APP_URL = `http://${SERVER_URL}:4000`; // process.env.EXPRESS_APP_URL;

async function _sendOpenOrderTabInner(user, baseAmount, quoteAmount, marketId) {
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

        if (!user.orderTabData[baseToken]) user.orderTabData[baseToken] = [];

        user.orderTabData[baseToken].push(grpcMessage.order_tab);

        return grpcMessage.order_tab;
      } else {
        let msg =
          "Failed to submit order with error: \n" +
          openTabResponse.error_message;
        console.log(msg);

        throw new Error(msg);
      }
    });
}

async function _sendCloseOrderTabInner(user, marketId, tabAddress) {
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

async function _sendModifyOrderTabInner(
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
  _sendOpenOrderTabInner,
  _sendCloseOrderTabInner,
  _sendModifyOrderTabInner,
};

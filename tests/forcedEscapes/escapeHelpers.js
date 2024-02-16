const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const path = require("path");
const protoPath = path.join(__dirname, "../", "engine.proto");

const SERVER_URL = "localhost";

// * Get a connection to the backend through grpc
const packageDefinition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const engine = grpc.loadPackageDefinition(packageDefinition).engine;

const client = new engine.Engine(
  `${SERVER_URL}:50052`,
  grpc.credentials.createInsecure()
);

async function testSendNoteEscape(escape_notes, escapeId, signature) {
  escape_notes = escape_notes.map((note) => {
    return {
      address: {
        x: note.addressX.toString(),
        y: note.addressY.toString(),
      },
      token: note.token.toString(),
      amount: note.amount.toString(),
      blinding: note.blinding.toString(),
      index: note.index.toString(),
    };
  });

  let escapeMessage = {
    escape_id: escapeId.toString(),
    escape_notes: escape_notes,
    signature: {
      r: signature[0].toString(),
      s: signature[1].toString(),
    },
  };

  console.log(escapeMessage);

  await client.execute_escape(escapeMessage, function (err, _response) {
    if (err) {
      console.log(err);
    }

    console.log(_response);
  });
}

async function testSendPositionEscape(
  position_a,
  open_order_fields_b,
  closePrice,
  recipient,
  escapeId,
  signature_a,
  signature_b
) {
  position_a = {
    index: position_a.index.toString(),
    position_header: {
      synthetic_token: position_a.synthetic_token.toString(),
      position_address: position_a.position_address.toString(),
      allow_partial_liquidations: position_a.allow_partial_liquidations,
      vlp_token: position_a.vlp_token.toString(),
    },
    order_side: !!position_a.order_side,
    position_size: position_a.position_size.toString(),
    margin: position_a.margin.toString(),
    entry_price: position_a.entry_price.toString(),
    liquidation_price: position_a.liquidation_price.toString(),
    bankruptcy_price: position_a.bankruptcy_price.toString(),
    last_funding_idx: position_a.last_funding_idx.toString(),
    vlp_supply: position_a.vlp_supply.toString(),
  };

  open_order_fields_b = {
    initial_margin: open_order_fields_b.initial_margin.toString(),
    collateral_token: open_order_fields_b.collateral_token.toString(),
    notes_in: open_order_fields_b.notes_in.map((note) => {
      return {
        address: {
          x: note.addressX.toString(),
          y: note.addressY.toString(),
        },
        token: note.token.toString(),
        amount: note.amount.toString(),
        blinding: note.blinding.toString(),
        index: note.index.toString(),
      };
    }),
    refund_note: open_order_fields_b.refund_note
      ? {
          address: {
            x: open_order_fields_b.refund_note.addressX.toString(),
            y: open_order_fields_b.refund_note.addressY.toString(),
          },
          token: open_order_fields_b.refund_note.token.toString(),
          amount: open_order_fields_b.refund_note.amount.toString(),
          blinding: open_order_fields_b.refund_note.blinding.toString(),
          index: open_order_fields_b.refund_note.index.toString(),
        }
      : null,
    position_address: open_order_fields_b.position_address,
    allow_partial_liquidations: open_order_fields_b.allow_partial_liquidations,
  };

  let escapeMessage = {
    escape_id: escapeId.toString(),
    close_position_message: {
      close_price: closePrice.toString(),
      position_a: position_a,
      open_order_fields_b: open_order_fields_b,
      position_b: null,
      recipient: recipient,
      signature_a: {
        r: signature_a[0].toString(),
        s: signature_a[1].toString(),
      },
      signature_b: {
        r: signature_b[0].toString(),
        s: signature_b[1].toString(),
      },
    },
  };

  console.log("escapeMessage", escapeMessage);

  await client.execute_escape(escapeMessage, function (err, _response) {
    if (err) {
      console.log(err);
    } else {
      console.log(_response);
    }
  });
}

module.exports = {
  testSendNoteEscape,
  testSendPositionEscape,
};

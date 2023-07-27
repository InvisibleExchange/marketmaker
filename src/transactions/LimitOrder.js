const { getKeyPair, sign } = require("starknet").ec;
const { computeHashOnElements, pedersen } = require("../helpers/pedersen");

/* global BigInt */

class LimitOrder {
  constructor(
    expiration_timestamp,
    token_spent,
    token_received,
    amount_spent,
    amount_received,
    fee_limit,
    spot_note_info,
    order_tab
  ) {
    this.expiration_timestamp = expiration_timestamp;
    this.token_spent = token_spent;
    this.token_received = token_received;
    this.amount_spent = amount_spent;
    this.amount_received = amount_received;
    this.fee_limit = fee_limit;
    //
    this.spot_note_info = spot_note_info;
    this.order_tab = order_tab;
    // --------------------------
    this.order_hash = this.hashOrder();
    this.signature = null;
  }

  hashOrder() {
    let hashInputs = [
      this.expiration_timestamp,
      this.token_spent,
      this.token_received,
      this.amount_spent,
      this.amount_received,
      this.fee_limit,
    ];

    let note_info_hash = this.spot_note_info ? this.spot_note_info.hash() : 0n;
    let order_tab_hash = this.order_tab ? this.order_tab.hash : 0n;
    hashInputs.push(note_info_hash);
    hashInputs.push(order_tab_hash);

    return computeHashOnElements(hashInputs);
  }

  signOrder(privKey) {
    let order_hash = this.hashOrder();

    const keyPair = getKeyPair(privKey);

    let sig = sign(keyPair, "0x" + order_hash.toString(16));

    this.signature = sig;

    return sig;
  }

  toGrpcObject() {
    return {
      expiration_timestamp: this.expiration_timestamp.toString(),
      token_spent: this.token_spent.toString(),
      token_received: this.token_received.toString(),
      amount_spent: this.amount_spent.toString(),
      amount_received: this.amount_received.toString(),
      fee_limit: this.fee_limit.toString(),
      spot_note_info: this.spot_note_info
        ? this.spot_note_info.toGrpcObject()
        : null,
      order_tab: this.order_tab ? this.order_tab.toGrpcObject() : null,
      signature: {
        r: this.signature[0].toString(),
        s: this.signature[1].toString(),
      },
    };
  }

  //   verify_order_signatures(sig) {
  //     let order_hash = this.hashOrder();

  //     let pub_key_sum = getKeyPair(0).getPublic();
  //     for (let i = 0; i < this.notesIn.length; i++) {
  //       pub_key_sum = pub_key_sum.add(this.notesIn[i].address);
  //     }

  //     let verifyKeyPair = getKeyPairFromPublicKey(pub_key_sum.encode());

  //     if (!verify(verifyKeyPair, order_hash.toString(16), sig)) {
  //       throw new Error("Signature verification failed");
  //     }
  //     console.log("Signature verification successful");
  //   }
}

class SpotNotesInfo {
  constructor(
    dest_received_address,
    dest_received_blinding,
    notes_in,
    refund_note
  ) {
    this.dest_received_address = dest_received_address;
    this.dest_received_blinding = dest_received_blinding;
    this.notes_in = notes_in;
    this.refund_note = refund_note;
  }

  hash() {
    let noteHashes = this.notes_in.map((note) => note.hash);
    let refundHash = this.refund_note ? this.refund_note.hash : 0n;

    let hashInputs = noteHashes
      .concat(refundHash)
      .concat([
        BigInt(this.dest_received_address.getX()),
        this.dest_received_blinding,
      ]);

    return computeHashOnElements(hashInputs);
  }

  toGrpcObject() {
    return {
      dest_received_address: {
        x: this.dest_received_address.getX().toString(),
        y: this.dest_received_address.getY().toString(),
      },
      dest_received_blinding: this.dest_received_blinding.toString(),
      notes_in: this.notes_in.map((note) => note.toGrpcObject()),
      refund_note: this.refund_note ? this.refund_note.toGrpcObject() : null,
    };
  }
}

// ORDER TABS ===================================================

class OrderTab {
  constructor(tab_idx, tab_header, base_amount, quote_amount) {
    this.tab_idx = tab_idx;
    this.tab_header = tab_header;
    this.base_amount = base_amount;
    this.quote_amount = quote_amount;
    this.hash = this.hash();
  }

  hash() {
    let base_commitment = pedersen([
      BigInt(this.base_amount),
      BigInt(this.tab_header.base_blinding),
    ]);
    let quote_commitment = pedersen([
      BigInt(this.quote_amount),
      BigInt(this.tab_header.quote_blinding),
    ]);

    let hashInputs = [
      this.tab_header.hash(),
      base_commitment,
      quote_commitment,
    ];

    return computeHashOnElements(hashInputs);
  }

  toGrpcObject() {
    return {
      tab_idx: this.tab_idx,
      tab_header: this.tab_header.toGrpcObject(),
      base_amount: this.base_amount,
      quote_amount: this.quote_amount,
    };
  }

  signOpenTabOrder(basePrivKeys, quotePrivKeys) {
    let pkSum = 0n;
    for (let i = 0; i < basePrivKeys.length; i++) {
      pkSum += BigInt(basePrivKeys[i]);
    }
    for (let i = 0; i < quotePrivKeys.length; i++) {
      pkSum += BigInt(quotePrivKeys[i]);
    }

    const keyPair = getKeyPair(pkSum);

    let sig = sign(keyPair, "0x" + this.hash.toString(16));

    return sig;
  }

  signCloseTabOrder(baseCloseOrderFields, quoteCloseOrderFields, tabPrivKey) {
    let hashInputs = [
      this.hash,
      baseCloseOrderFields.hash(),
      quoteCloseOrderFields.hash(),
    ];
    let hash = computeHashOnElements(hashInputs);

    const keyPair = getKeyPair(BigInt(tabPrivKey));

    let sig = sign(keyPair, "0x" + hash.toString(16));

    return sig;
  }
}

class TabHeader {
  constructor(
    expiration_timestamp,
    is_perp,
    is_smart_contract,
    base_token,
    quote_token,
    base_blinding,
    quote_blinding,
    pub_key
  ) {
    this.expiration_timestamp = expiration_timestamp;
    this.is_perp = is_perp;
    this.is_smart_contract = is_smart_contract;
    this.base_token = base_token;
    this.quote_token = quote_token;
    this.base_blinding = BigInt(base_blinding);
    this.quote_blinding = BigInt(quote_blinding);
    this.pub_key = BigInt(pub_key);
  }

  hash() {
    let hashInputs = [
      this.expiration_timestamp,
      this.is_perp ? 1n : 0n,
      this.is_smart_contract ? 1n : 0n,
      this.base_token,
      this.quote_token,
      this.base_blinding,
      this.quote_blinding,
      this.pub_key,
    ];

    return computeHashOnElements(hashInputs);
  }

  toGrpcObject() {
    return {
      expiration_timestamp: this.expiration_timestamp,
      is_perp: this.is_perp,
      is_smart_contract: this.is_smart_contract,
      base_token: this.base_token,
      quote_token: this.quote_token,
      base_blinding: this.base_blinding.toString(),
      quote_blinding: this.quote_blinding.toString(),
      pub_key: this.pub_key.toString(),
    };
  }
}

module.exports = {
  LimitOrder,
  SpotNotesInfo,
  OrderTab,
  TabHeader,
};

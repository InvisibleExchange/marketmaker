const { getKeyPair, sign } = require("starknet").ec;
const { computeHashOnElements } = require("../helpers/pedersen");

/* global BigInt */

module.exports = class LimitOrder {
  constructor(
    expiration_timestamp,
    token_spent,
    token_received,
    amount_spent,
    amount_received,
    fee_limit,
    dest_received_address,
    dest_received_blinding,
    notes_in,
    refund_note
  ) {
    this.expiration_timestamp = expiration_timestamp;
    this.token_spent = token_spent;
    this.token_received = token_received;
    this.amount_spent = amount_spent;
    this.amount_received = amount_received;
    this.fee_limit = fee_limit;
    this.dest_received_address = dest_received_address;
    this.dest_received_blinding = dest_received_blinding;
    // ==================================
    this.notes_in = notes_in;
    this.refund_note = refund_note;
    this.order_hash = this.hashOrder();
    this.signature = null;
  }

  hashOrder() {
    let noteHashes = this.notes_in.map((note) => note.hash);
    let refundHash = this.refund_note ? this.refund_note.hash : 0n;

    let hashInputs = noteHashes
      .concat(refundHash)
      .concat([
        this.expiration_timestamp,
        this.token_spent,
        this.token_received,
        this.amount_spent,
        this.amount_received,
        this.fee_limit,
        BigInt(this.dest_received_address.getX()),
        this.dest_received_blinding,
      ]);

    return computeHashOnElements(hashInputs);
  }

  signOrder(priv_keys) {
    let order_hash = this.hashOrder();

    let pk_sum = 0n;
    for (let i = 0; i < priv_keys.length; i++) {
      pk_sum += BigInt(priv_keys[i]);
    }

    const keyPair = getKeyPair(pk_sum);

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
      dest_received_address: {
        x: this.dest_received_address.getX().toString(),
        y: this.dest_received_address.getY().toString(),
      },
      dest_received_blinding: this.dest_received_blinding.toString(),
      notes_in: this.notes_in.map((note) => note.toGrpcObject()),
      refund_note: this.refund_note ? this.refund_note.toGrpcObject() : null,
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
};

const { getKeyPair, sign } = require("starknet").ec;
const { computeHashOnElements, pedersen } = require("../helpers/pedersen");

/* global BigInt */
class LiquidationOrder {
  constructor(
    position, // Position being liquidated
    order_side,
    synthetic_token,
    synthetic_amount,
    collateral_amount,
    open_order_fields
  ) {
    this.position = position ? { ...position } : null;
    this.order_side = order_side;
    this.synthetic_token = synthetic_token;
    this.synthetic_amount = synthetic_amount;
    this.collateral_amount = collateral_amount;
    // -------------------
    this.open_order_fields = open_order_fields;
    // -------------------
    this.signature = null;
  }

  hashOrder() {
    let order_side;
    switch (this.order_side) {
      case "Long":
        order_side = 1n;
        break;
      case "Short":
        order_side = 0n;
        break;
      default:
        throw "invalid order side (should be binary)";
    }

    // [3025527714703873597024264839110661521520625888662764179864122432945230702519, 1, 12345, 982300000, 32448315900]

    // [
    //   '1205281518540558603652154109576508339453916441519633692987676295127626027733',
    //   1n,
    //   12345,
    //   982300000,
    //   32448315900
    // ]

    let position_address = this.position.position_address;

    let hash_inputs = [
      position_address,
      order_side,
      this.synthetic_token,
      this.synthetic_amount,
      this.collateral_amount,
    ];

    console.log("hash_inputs: ", hash_inputs);

    let order_hash = computeHashOnElements(hash_inputs);
    let fields_hash = this.open_order_fields.hash();

    return pedersen([order_hash, fields_hash]);
  }

  signOrder(privKeys) {
    let orderHash = this.hashOrder();

    let pkSum = 0n;
    for (const pk of privKeys) {
      pkSum += pk;
    }

    let keyPair = getKeyPair(pkSum);

    let sig = sign(keyPair, "0x" + orderHash.toString(16));

    this.signature = sig;
    return sig;
  }

  toGrpcObject() {
    let order_side;
    switch (this.order_side) {
      case "Long":
        order_side = 1;
        break;
      case "Short":
        order_side = 0;
        break;

      default:
        throw "invalid position effect type";
    }

    let open_order_fields = this.open_order_fields.toGrpcObject();

    this.position.order_side = this.position.order_side == "Long" ? 1 : 0;

    return {
      position: this.position,
      order_side,
      synthetic_token: this.synthetic_token.toString(),
      synthetic_amount: this.synthetic_amount.toString(),
      collateral_amount: this.collateral_amount.toString(),
      open_order_fields,
      signature: {
        r: this.signature[0].toString(),
        s: this.signature[1].toString(),
      },
    };
  }
}

module.exports = {
  LiquidationOrder,
};

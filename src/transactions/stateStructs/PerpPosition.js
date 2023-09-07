const { pedersen, computeHashOnElements } = require("../../helpers/pedersen");
const { getKeyPair, sign } = require("starknet").ec;

//* =============================================================================
//* ORDER TABS

class PerpPosition {
  constructor(
    index,
    position_header,
    order_side,
    position_size,
    margin,
    entry_price,
    liquidation_price,
    bankruptcy_price,
    last_funding_idx,
    vlp_supply
  ) {
    this.index = index;
    this.position_header = position_header;
    this.order_side = order_side;
    this.position_size = position_size;
    this.margin = margin;
    this.entry_price = entry_price;
    this.liquidation_price = liquidation_price;
    this.bankruptcy_price = bankruptcy_price;
    this.last_funding_idx = last_funding_idx;
    this.vlp_supply = vlp_supply;
    this.hash = this.hash();
  }

  hash() {
    return PerpPosition.hashPosition(
      this.position_header.hash,
      this.order_side,
      this.position_size,
      this.entry_price,
      this.liquidation_price,
      this.last_funding_idx,
      this.vlp_supply
    );
  }

  static hashPosition(
    header_hash,
    order_side,
    position_size,
    entry_price,
    liquidation_price,
    current_funding_idx,
    vlp_supply
  ) {
    // & hash = H({header_hash, order_side, position_size, entry_price, liquidation_price, current_funding_idx, vlp_supply})

    let hashInputs = [
      header_hash,
      order_side,
      position_size,
      entry_price,
      liquidation_price,
      current_funding_idx,
      vlp_supply,
    ];

    return computeHashOnElements(hashInputs);
  }

  toGrpcObject() {
    return {
      index: this.index,
      position_header: this.position_header.toGrpcObject(),
      order_side: this.order_side,
      position_size: this.position_size,
      margin: this.margin,
      entry_price: this.entry_price,
      liquidation_price: this.liquidation_price,
      bankruptcy_price: this.bankruptcy_price,
      last_funding_idx: this.last_funding_idx,
      vlp_supply: this.vlp_supply,
    };
  }

  static fromGrpcObject(grpcMessage) {
    let positionHeader = PositionHeader.fromGrpcObject(
      grpcMessage.position_header
    );

    return new PerpPosition(
      grpcMessage.index,
      positionHeader,
      grpcMessage.order_side,
      grpcMessage.position_size,
      grpcMessage.margin,
      grpcMessage.entry_price,
      grpcMessage.liquidation_price,
      grpcMessage.bankruptcy_price,
      grpcMessage.last_funding_idx,
      grpcMessage.vlp_supply
    );
  }
}

// * ==== ======== ========== ======= ============ ========== ========== =========

class PositionHeader {
  constructor(
    synthetic_token,
    position_address,
    allow_partial_liquidations,
    vlp_token,
    max_vlp_supply
  ) {
    this.synthetic_token = synthetic_token;
    this.position_address = position_address;
    this.allow_partial_liquidations = allow_partial_liquidations;
    this.vlp_token = vlp_token;
    this.max_vlp_supply = max_vlp_supply;
    this.hash = this.hash();
  }

  // & hash = H({allow_partial_liquidations, synthetic_token, position_address,  vlp_token, max_vlp_supply})
  hash() {
    let hashInputs = [
      this.allow_partial_liquidations ? 1n : 0n,
      this.synthetic_token,
      this.position_address,
      this.vlp_token,
      this.max_vlp_supply,
    ];

    return computeHashOnElements(hashInputs);
  }

  toGrpcObject() {
    return {
      allow_partial_liquidations: this.allow_partial_liquidations,
      synthetic_token: this.synthetic_token,
      position_address: this.position_address.toString(),
      vlp_token: this.vlp_token,
      max_vlp_supply: this.max_vlp_supply,
    };
  }

  static fromGrpcObject(grpcMessage) {
    return new PositionHeader(
      grpcMessage.synthetic_token,
      BigInt(grpcMessage.position_address),
      grpcMessage.allow_partial_liquidations,
      grpcMessage.vlp_token,
      grpcMessage.max_vlp_supply
    );
  }
}

module.exports = {
  PerpPosition,
  PositionHeader,
};

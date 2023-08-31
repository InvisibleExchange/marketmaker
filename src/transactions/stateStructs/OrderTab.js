const { pedersen, computeHashOnElements } = require("../../helpers/pedersen");
const { getKeyPair, sign } = require("starknet").ec;

//* =============================================================================
//* ORDER TABS

class OrderTab {
  constructor(tab_idx, tab_header, base_amount, quote_amount, vlp_supply) {
    this.tab_idx = tab_idx;
    this.tab_header = tab_header;
    this.base_amount = base_amount;
    this.quote_amount = quote_amount;
    this.vlp_supply = vlp_supply;
    this.hash = this.hash();
  }

  hash() {
    return OrderTab.hashOrderTab(
      this.tab_header.hash(),
      this.tab_header.base_blinding,
      this.tab_header.quote_blinding,
      this.base_amount,
      this.quote_amount
    );
  }

  static hashOrderTab(
    header_hash,
    base_blinding,
    quote_blinding,
    base_amount,
    quote_amount,
    vlpSupply
  ) {
    let base_commitment = pedersen([
      BigInt(base_amount),
      BigInt(base_blinding),
    ]);
    let quote_commitment = pedersen([
      BigInt(quote_amount),
      BigInt(quote_blinding),
    ]);

    let blindingSum = BigInt(base_blinding) / 2n + BigInt(quote_blinding) / 2n;
    let vlpSupplyCommitment =
      vlpSupply > 0 ? pedersen(BigInt(vlpSupply), blindingSum) : 0n;

    let hashInputs = [
      header_hash,
      base_commitment,
      quote_commitment,
      vlpSupplyCommitment,
    ];

    return computeHashOnElements(hashInputs);
  }

  toGrpcObject() {
    return {
      tab_idx: this.tab_idx,
      tab_header: this.tab_header.toGrpcObject(),
      base_amount: this.base_amount,
      quote_amount: this.quote_amount,
      vlp_supply: this.vlp_supply,
    };
  }

  static fromGrpcObject(grpcMessage) {
    let tabHeader = TabHeader.fromGrpcObject(grpcMessage.tab_header);

    return new OrderTab(
      grpcMessage.tab_idx,
      tabHeader,
      grpcMessage.base_amount,
      grpcMessage.quote_amount,
      grpcMessage.vlp_supply
    );
  }

  signOpenTabOrder(
    basePrivKeys,
    quotePrivKeys,
    baseRefundNote,
    quoteRefundNote
  ) {
    let pkSum = 0n;
    for (let i = 0; i < basePrivKeys.length; i++) {
      pkSum += BigInt(basePrivKeys[i]);
    }
    for (let i = 0; i < quotePrivKeys.length; i++) {
      pkSum += BigInt(quotePrivKeys[i]);
    }

    const keyPair = getKeyPair(pkSum);

    let hashInputs = [
      0n,
      this.hash,
      baseRefundNote ? baseRefundNote.hash : 0n,
      quoteRefundNote ? quoteRefundNote.hash : 0n,
    ];

    let hash = computeHashOnElements(hashInputs);

    let sig = sign(keyPair, "0x" + hash.toString(16));

    return sig;
  }
}

class TabHeader {
  constructor(
    is_smart_contract,
    base_token,
    quote_token,
    base_blinding,
    quote_blinding,
    vlp_token,
    max_vlp_supply,
    pub_key
  ) {
    this.is_smart_contract = is_smart_contract;
    this.base_token = base_token;
    this.quote_token = quote_token;
    this.base_blinding = BigInt(base_blinding);
    this.quote_blinding = BigInt(quote_blinding);
    this.vlp_token = vlp_token;
    this.max_vlp_supply = max_vlp_supply;
    this.pub_key = BigInt(pub_key);
  }

  // & header_hash = H({ is_smart_contract, base_token, quote_token, vlp_token, max_vlp_supply, pub_key})
  hash() {
    let hashInputs = [
      this.is_smart_contract ? 1n : 0n,
      this.base_token,
      this.quote_token,
      this.vlp_token,
      this.max_vlp_supply,
      this.pub_key,
    ];

    return computeHashOnElements(hashInputs);
  }

  toGrpcObject() {
    return {
      is_smart_contract: this.is_smart_contract,
      base_token: this.base_token,
      quote_token: this.quote_token,
      base_blinding: this.base_blinding.toString(),
      quote_blinding: this.quote_blinding.toString(),
      vlp_token: this.vlp_token,
      max_vlp_supply: this.max_vlp_supply,
      pub_key: this.pub_key.toString(),
    };
  }

  static fromGrpcObject(grpcMessage) {
    return new TabHeader(
      grpcMessage.is_smart_contract,
      grpcMessage.base_token,
      grpcMessage.quote_token,
      grpcMessage.base_blinding,
      grpcMessage.quote_blinding,
      grpcMessage.vlp_token,
      grpcMessage.max_vlp_supply,
      grpcMessage.pub_key
    );
  }
}

module.exports = {
  OrderTab,
  TabHeader,
};

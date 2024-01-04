const ethers = require("ethers");
const { sign, getKeyPair } = require("starknet").ec;

const EXCHANGE_CONFIG = require("../exchange-config.json");

const path = require("path");
const dotenv = require("dotenv");
const {
  COLLATERAL_TOKEN,
  DECIMALS_PER_ASSET,
  PRICE_DECIMALS_PER_ASSET,
  DUST_AMOUNT_PER_ASSET,
} = require("invisible-sdk/src/utils");
const { Note } = require("invisible-sdk/src/transactions");
dotenv.config({ path: path.join(__dirname, "../.env") });

let privateKey = process.env.ETH_PRIVATE_KEY;
const provider = new ethers.providers.JsonRpcProvider(
  process.env.ETH_RPC_URL,
  "sepolia"
);
const signer = new ethers.Wallet(privateKey, provider);

const escapeVerifierAddress = EXCHANGE_CONFIG["ESCAPE_VERIFIER_ETH_ADDRESS"];
const escapeVerifierAbi = require("./abis/EscapeVerifier.json").abi;
const escapeVerifierContract = new ethers.Contract(
  escapeVerifierAddress,
  escapeVerifierAbi,
  signer ?? undefined
);

// * NOTE ESCAPE ----------------------------------------------
async function executeNoteEscape(marketMaker) {
  let notesIn = [];
  let privKeySum = 0n;
  for (let token of Object.keys(marketMaker.noteData)) {
    for (let note of marketMaker.noteData[token]) {
      notesIn.push({
        index: note.index,
        addressX: note.address.getX().toString(),
        addressY: note.address.getY().toString(),
        token: note.token,
        amount: note.amount,
        blinding: note.blinding,
      });

      privKeySum += marketMaker.notePrivKeys[note.address.getX().toString()];
    }
  }

  let hashInputs = notesIn.map((note) => BigInt(hashNoteKeccak(note), 16));
  let escapeHash = ethers.utils.keccak256(
    ethers.utils.solidityPack(["uint256[]"], [hashInputs])
  );

  const P = 2n ** 251n + 17n * 2n ** 192n + 1n;
  escapeHash = BigInt(escapeHash) % P;

  let keyPairSum = getKeyPair(privKeySum);
  let signature = sign(keyPairSum, "0x" + escapeHash.toString(16));

  let txRes = await escapeVerifierContract
    .startNoteEscape(notesIn, signature, {
      gasLimit: 300_000,
    })
    .catch((err) => {
      console.log("err: ", err);
    });

  console.log("txRes hash: ", txRes.hash);
  let receipt = await txRes.wait();

  return receipt;
}

function hashNoteKeccak(note) {
  // & H = H({address, token, amount, blinding})

  let hashInput = [note.addressX, note.token, note.amount, note.blinding];

  let noteHash = ethers.utils.keccak256(
    ethers.utils.solidityPack(["uint256[]"], [hashInput])
  );

  const P = 2n ** 251n + 17n * 2n ** 192n + 1n;
  noteHash = BigInt(noteHash) % P;

  return noteHash;
}

// * ORDER TAB ESCAPE -----------------------------------------
async function executeTabEscape(marketMaker, syntheticToken, tabAddress) {
  let orderTab = marketMaker.orderTabData[syntheticToken].find((tab) => {
    return tab.tab_header.pub_key == tabAddress;
  });
  orderTab = {
    tab_idx: orderTab.tab_idx,
    base_token: orderTab.tab_header.base_token,
    quote_token: orderTab.tab_header.quote_token,
    base_blinding: orderTab.tab_header.base_blinding,
    quote_blinding: orderTab.tab_header.quote_blinding,
    pub_key: orderTab.tab_header.pub_key,
    base_amount: orderTab.base_amount,
    quote_amount: orderTab.quote_amount,
  };

  let escapeHash = hashTabKeccak(orderTab);

  const P = 2n ** 251n + 17n * 2n ** 192n + 1n;
  escapeHash = BigInt(escapeHash) % P;

  let keyPair = getKeyPair(marketMaker.tabPrivKeys[orderTab.pub_key]);
  let signature = sign(keyPair, "0x" + escapeHash.toString(16));

  let txRes = await escapeVerifierContract
    .startOrderTabEscape(orderTab, signature, {
      gasLimit: 300_000,
    })
    .catch((err) => {
      console.log("err: ", err);
    });

  console.log("txRes hash: ", txRes.hash);
  let receipt = await txRes.wait();

  return receipt;
}

function hashTabKeccak(tab) {
  // & H({base_token, quote_token, pub_key, base_amount, quote_amount})

  let hashInput = [
    tab.base_token,
    tab.quote_token,
    tab.pub_key,
    tab.base_amount,
    tab.quote_amount,
  ];

  let tabHash = ethers.utils.keccak256(
    ethers.utils.solidityPack(["uint256[]"], [hashInput])
  );

  const P = 2n ** 251n + 17n * 2n ** 192n + 1n;
  tabHash = BigInt(tabHash) % P;

  return tabHash;
}

// * POSITION ESCAPE -----------------------------------------
async function executePositionEscape(
  marketMaker,
  syntheticToken,
  closePrice,
  recipient,
  positionAddress_A,
  positionAddress_B,
  initMarginAmount
) {
  closePrice = closePrice * 10 ** PRICE_DECIMALS_PER_ASSET[syntheticToken];

  let position_a = marketMaker.positionData[syntheticToken].find((pos) => {
    return pos.position_header.position_address == positionAddress_A;
  });
  position_a = {
    index: position_a.index,
    synthetic_token: position_a.position_header.synthetic_token,
    position_address: position_a.position_header.position_address,
    allow_partial_liquidations:
      position_a.position_header.allow_partial_liquidations,
    vlp_token: position_a.position_header.vlp_token,
    max_vlp_supply: position_a.position_header.max_vlp_supply,
    order_side: position_a.order_side == "Long",
    position_size: position_a.position_size,
    margin: position_a.margin,
    entry_price: position_a.entry_price,
    liquidation_price: position_a.liquidation_price,
    bankruptcy_price: position_a.bankruptcy_price,
    last_funding_idx: position_a.last_funding_idx,
    vlp_supply: position_a.vlp_supply,
  };

  let positionAHash = hashPositionKeccak(position_a);

  let positionB;
  let openOrderFieldsB;

  let hashB;
  let privKeyB;
  if (positionAddress_B) {
    let position_b = marketMaker.positionData[syntheticToken].find((pos) => {
      return pos.position_header.position_address == positionAddress_B;
    });
    position_b = {
      index: position_b.index,
      synthetic_token: position_b.position_header.synthetic_token,
      position_address: position_b.position_header.position_address,
      allow_partial_liquidations:
        position_b.position_header.allow_partial_liquidations,
      vlp_token: position_b.position_header.vlp_token,
      max_vlp_supply: position_b.position_header.max_vlp_supply,
      order_side: position_b.order_side,
      position_size: position_b.position_size,
      margin: position_b.margin,
      entry_price: position_b.entry_price,
      liquidation_price: position_b.liquidation_price,
      bankruptcy_price: position_b.bankruptcy_price,
      last_funding_idx: position_b.last_funding_idx,
      vlp_supply: position_b.vlp_supply,
    };

    hashB = hashPositionKeccak(position_b);
    privKeyB = marketMaker.positionPrivKeys[positionAddress_B];
  } else {
    // ? Get the notesIn and priv keys for these notes
    let { notesIn, refundAmount } = marketMaker.getNotesInAndRefundAmount(
      COLLATERAL_TOKEN,
      initMarginAmount * 10 ** DECIMALS_PER_ASSET[COLLATERAL_TOKEN]
    );

    // ? Generate the dest spent and dest received addresses and blindings
    let pkSum = notesIn.reduce((acc, note) => {
      return acc + note.privKey;
    }, 0n);

    let refundNote;
    if (refundAmount > DUST_AMOUNT_PER_ASSET[COLLATERAL_TOKEN]) {
      let { KoR, koR, ytR } =
        marketMaker.getDestReceivedAddresses(syntheticToken);
      marketMaker.notePrivKeys[KoR.getX().toString()] = koR;

      refundNote = new Note(
        KoR,
        COLLATERAL_TOKEN,
        refundAmount,
        ytR,
        notesIn[0].note.index
      );
    }

    let { positionPrivKey, positionAddress } =
      marketMaker.getPositionAddress(syntheticToken);
    marketMaker.positionPrivKeys[positionAddress.getX().toString()] =
      positionPrivKey;

    openOrderFieldsB = {
      initial_margin:
        initMarginAmount * 10 ** DECIMALS_PER_ASSET[COLLATERAL_TOKEN],
      collateral_token: COLLATERAL_TOKEN,
      notes_in: notesIn.map((note) => {
        note = note.note;
        return {
          index: note.index,
          addressX: note.address.getX().toString(),
          addressY: note.address.getY().toString(),
          token: note.token,
          amount: note.amount,
          blinding: note.blinding,
        };
      }),
      refund_note: {
        index: refundNote.index,
        addressX: refundNote.address.getX().toString(),
        addressY: refundNote.address.getY().toString(),
        token: refundNote.token,
        amount: refundNote.amount,
        blinding: refundNote.blinding,
      },
      position_address: positionAddress.getX().toString(),
      allow_partial_liquidations: true,
    };

    console.log("fields", openOrderFieldsB);

    hashB = hashOpenOrderFieldsKeccak(openOrderFieldsB);
    privKeyB = pkSum;
  }

  let escapeHash = hashPositionEscape(
    positionAHash,
    closePrice,
    hashB,
    recipient.toString().startsWith("0x")
      ? BigInt(recipient, 16)
      : BigInt(recipient)
  );

  const P = 2n ** 251n + 17n * 2n ** 192n + 1n;
  escapeHash = BigInt(escapeHash) % P;

  let keyPairA = getKeyPair(marketMaker.positionPrivKeys[positionAddress_A]);
  let signatureA = sign(keyPairA, "0x" + escapeHash.toString(16));

  let keyPairB = getKeyPair(privKeyB);
  let signatureB = sign(keyPairB, "0x" + escapeHash.toString(16));

  console.log("position_a: ", position_a);
  console.log("escapeHash: ", escapeHash);
  console.log("signatureA: ", signatureA);
  console.log("signatureB: ", signatureB);

  let txRes;
  if (positionB) {
    txRes = await escapeVerifierContract
      .startPositionEscape1(
        position_a,
        closePrice,
        positionB,
        recipient,
        signatureA,
        signatureB,
        {
          gasLimit: 300_000,
        }
      )
      .catch((err) => {
        console.log("err: ", err);
      });
  } else {
    txRes = await escapeVerifierContract
      .startPositionEscape2(
        position_a,
        closePrice,
        openOrderFieldsB,
        recipient,
        signatureA,
        signatureB,
        {
          gasLimit: 300_000,
        }
      )
      .catch((err) => {
        console.log("err: ", err);
      });
  }

  console.log("txRes hash: ", txRes.hash);
  let receipt = await txRes.wait();

  return receipt;
}

function hashPositionEscape(positionAHash, closePrice, hashB, recipient) {
  // & H = (position_a.hash, close_price, open_order_fields_b.hash, recipient)

  let hashInput = [positionAHash, closePrice, hashB, recipient];


  let escapeHash = ethers.utils.keccak256(
    ethers.utils.solidityPack(["uint256[]"], [hashInput])
  );

  const P = 2n ** 251n + 17n * 2n ** 192n + 1n;
  escapeHash = BigInt(escapeHash) % P;

  return escapeHash;
}

function hashPositionKeccak(position) {
  // & hash = H({allow_partial_liquidations, synthetic_token, position_address, vlp_token, max_vlp_supply, order_side, position_size, entry_price, liquidation_price, last_funding_idx, vlp_supply})

  let hashInput = [
    position.allow_partial_liquidations ? 1 : 0,
    position.synthetic_token,
    position.position_address,
    position.vlp_token,
    position.max_vlp_supply,
    position.order_side ? 1 : 0,
    position.position_size,
    position.entry_price,
    position.liquidation_price,
    position.last_funding_idx,
    position.vlp_supply,
  ];

  let posHash = ethers.utils.keccak256(
    ethers.utils.solidityPack(["uint256[]"], [hashInput])
  );

  const P = 2n ** 251n + 17n * 2n ** 192n + 1n;
  posHash = BigInt(posHash) % P;

  return posHash;
}

function hashOpenOrderFieldsKeccak(fields) {
  // & H = (note_hashes, refund_note_hash, initial_margin, collateral_token, position_address, allow_partial_liquidations)

  let hashInput = fields.notes_in
    .map((note) => {
      return BigInt(hashNoteKeccak(note), 16);
    })
    .concat([
      fields.refund_note ? BigInt(hashNoteKeccak(fields.refund_note), 16) : 0n,
      fields.initial_margin,
      fields.collateral_token,
      fields.position_address,
      fields.allow_partial_liquidations ? 1 : 0,
    ]);

  let posHash = ethers.utils.keccak256(
    ethers.utils.solidityPack(["uint256[]"], [hashInput])
  );

  const P = 2n ** 251n + 17n * 2n ** 192n + 1n;
  posHash = BigInt(posHash) % P;

  return posHash;
}

module.exports = {
  executeNoteEscape,
  executeTabEscape,
  executePositionEscape,
};

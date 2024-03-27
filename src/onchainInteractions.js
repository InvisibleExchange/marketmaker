const ethers = require("ethers");

const ADDRESS_CONFIG = require("../address-config.json");
const ONCHAIN_DECIMALS_PER_ASSET = ADDRESS_CONFIG["ONCHAIN_DECIMALS_PER_ASSET"];
// const TOKEN_ID_2_ADDRESS = ADDRESS_CONFIG  ["TOKEN_ID_2_ADDRESS"];

const path = require("path");
const dotenv = require("dotenv");
const {
  storeUserState,
  COLLATERAL_TOKEN,
  SYMBOLS_TO_IDS,
  IDS_TO_SYMBOLS,
} = require("invisible-sdk/src/utils");
dotenv.config({ path: path.join(__dirname, "../.env") });

let privateKey = process.env.ETH_PRIVATE_KEY;
const provider = new ethers.providers.JsonRpcProvider(
  process.env.ETH_RPC_URL,
  "sepolia"
);
const signer = new ethers.Wallet(privateKey, provider);

const invisibleAddress = ADDRESS_CONFIG["L1"]["Invisible"];
const invisibleL1Abi = require("./abis/InvisibleL1.json").abi;
const invisibleContract = new ethers.Contract(
  invisibleAddress,
  invisibleL1Abi,
  signer ?? undefined
);

async function executeDepositTx(user, amount, token) {
  let depositStarkKey = user.getDepositStarkKey(token);

  let depositAmount =
    BigInt(amount * 1000) *
    10n ** BigInt(ONCHAIN_DECIMALS_PER_ASSET[token] - 3);

  // ! If ETH
  if (token == SYMBOLS_TO_IDS["ETH"]) {
    let tokenBalance = await signer.getBalance();

    if (tokenBalance < amount) {
      throw new Error("Not enough balance");
    }

    let txRes = await invisibleContract
      .makeDeposit(
        "0x0000000000000000000000000000000000000000",
        0,
        depositStarkKey,
        { gasLimit: 3000000, value: depositAmount }
      )
      .catch((err) => {
        if (err.message.includes("user rejected transaction")) {
          throw Error("User rejected transaction");
        }
      });
    let receipt = await txRes.wait();
    console.log("txRes hash: ", txRes.hash);
    let txHash = receipt.transactionHash;

    // ? Get the events emitted by the transaction
    let deposit;
    receipt.logs.forEach((log) => {
      try {
        const event = invisibleContract.interface.parseLog(log);
        if (event) {
          if (event.name == "DepositEvent") {
            deposit = {
              depositId: event.args.depositId.toString(),
              starkKey: event.args.pubKey.toString(),
              tokenId: event.args.tokenId.toString(),
              amount: event.args.depositAmountScaled.toString(),
              timestamp: event.args.timestamp.toString(),
              txHash: txHash.toString(),
            };
            return;
          }
        }
      } catch (e) {
        console.log("e: ", e);
      }
    });

    user.depositIds.push(deposit.depositId);
    user.deposits.push(deposit);

    await storeUserState(user.db, user).catch((err) => {
      console.log("err: ", err);
    });

    return deposit;
  }
  // ! If ERC20
  else {
    // NOTE: Token has to be approved first!

    await approveERC20(token, depositAmount);

    let tokenAddress = ADDRESS_CONFIG["L1"][IDS_TO_SYMBOLS[token]];
    let txRes = await invisibleContract
      .makeDeposit(tokenAddress, depositAmount, depositStarkKey, {
        gasLimit: 3000000,
      })
      .catch((err) => {
        if (err.message.includes("user rejected transaction")) {
          throw Error("User rejected transaction");
        }
      });
    console.log("txRes hash: ", txRes.hash);
    let receipt = await txRes.wait();
    let txHash = receipt.transactionHash;

    // ? Get the events emitted by the transaction
    let deposit;
    receipt.logs.forEach((log) => {
      try {
        const event = invisibleContract.interface.parseLog(log);
        if (event) {
          if (event.name == "DepositEvent") {
            deposit = {
              depositId: event.args.depositId.toString(),
              starkKey: event.args.pubKey.toString(),
              tokenId: event.args.tokenId.toString(),
              amount: event.args.depositAmountScaled.toString(),
              timestamp: event.args.timestamp.toString(),
              txHash: txHash.toString(),
            };
            return;
          }
        }
      } catch (e) {
        console.log("e: ", e);
      }
    });

    user.depositIds.push(deposit.depositId);
    user.deposits.push(deposit);

    await storeUserState(user.db, user).catch((err) => {
      console.log("err: ", err);
    });

    return deposit;
  }
}

// * ======================================================================
// * Smart contract MM Actions

async function executeMMRegistration(syntheticAsset, positionAddress) {
  positionAddress = positionAddress.toString(16);

  let txRes = await invisibleContract
    .registerPerpMarketMaker(syntheticAsset, positionAddress, {
      gasLimit: 300_000,
    })
    .catch((err) => {
      console.log("err: ", err);
    });

  console.log("txRes hash: ", txRes.hash);
  let receipt = await txRes.wait();

  return receipt;
}

async function executeCloseMM(positionAddress) {
  positionAddress = positionAddress.toString(16);

  let txRes = await invisibleContract
    .closePerpMarketMaker(positionAddress, {
      gasLimit: 300_000,
    })
    .catch((err) => {
      console.log("err: ", err);
    });

  console.log("txRes hash: ", txRes.hash);
  let receipt = await txRes.wait();

  return receipt;
}

async function executeProvideLiquidity(
  syntheticToken,
  positionAddress,
  usdcAmount
) {
  positionAddress = positionAddress.toString(16);

  usdcAmount =
    BigInt(usdcAmount) *
    10n ** BigInt(ONCHAIN_DECIMALS_PER_ASSET[COLLATERAL_TOKEN]);

  await approveERC20(SYMBOLS_TO_IDS["USDC"], usdcAmount);

  let txRes = await invisibleContract
    .provideLiquidity(syntheticToken, positionAddress, usdcAmount, {
      gasLimit: 300_000,
    })
    .catch((err) => {
      console.log("err: ", err);
    });

  console.log("txRes hash: ", txRes.hash);
  let receipt = await txRes.wait();

  return receipt;
}

async function approveERC20(tokenId, tokenAmount) {
  // ? Get the Token contract instance
  let tokenAddress = ADDRESS_CONFIG["L1"][IDS_TO_SYMBOLS[tokenId]];
  const erc20Abi = require("./abis/Erc20.json").abi;
  const tokenContract = new ethers.Contract(
    tokenAddress,
    erc20Abi,
    signer ?? undefined
  );

  let userAddress = await signer.getAddress();
  let tokenBalance = await tokenContract.balanceOf(userAddress);

  if (tokenBalance < tokenAmount) {
    throw new Error("Not enough balance");
  }

  let allowance = await tokenContract.allowance(
    userAddress,
    invisibleContract.address
  );
  if (allowance < tokenAmount) {
    let txRes = await tokenContract
      .approve(invisibleContract.address, tokenAmount)
      .catch((err) => {
        console.log("err: ", err);
      });
    await txRes.wait();
  }
}

module.exports = {
  executeDepositTx,
  executeMMRegistration,
  executeCloseMM,
  executeProvideLiquidity,
};

// Test 1

const { ethers, Wallet } = require("ethers");
const {
  DECIMALS_PER_ASSET,
  CHAIN_IDS,
  SPOT_MARKET_IDS_2_TOKENS,
} = require("../../src/helpers/utils");
const {
  sendDeposit,
  sendSpotOrder,
  sendWithdrawal,
  sendOpenOrderTab,
  sendRegisterMm,
} = require("../../src/transactions/constructOrders");
const UserState = require("../../src/users/Invisibl3User");

async function makeDeposits() {
  let privKey = 1234n;
  let user = UserState.fromPrivKey(privKey);

  await user.login();

  let deposit1 = {
    depositId: 39045156845912064n,
    pubKey:
      2166840471905619448909926965843998034165267473744647928190851627614183386065n,
    token: 55555,
    amount: 2000000000 / 10 ** DECIMALS_PER_ASSET[55555],
  };

  let deposit2 = {
    depositId: 39045156845912065n,
    pubKey:
      2292025268456116477323356083246651802150462734710453904748677715907532488444n,
    token: 54321,
    amount: 2000000000 / 10 ** DECIMALS_PER_ASSET[54321],
  };

  await sendDeposit(
    user,
    deposit1.depositId,
    deposit1.amount,
    deposit1.token,
    deposit1.pubKey
  );

  await sendDeposit(
    user,
    deposit2.depositId,
    deposit2.amount,
    deposit2.token,
    deposit2.pubKey
  );
}

async function makeTestSwaps() {
  let privKey = 1234n;
  let user = UserState.fromPrivKey(privKey);

  await user.login();

  let swapEthPrice = 1600;

  let baseAmount = 1;
  let quoteAmount = 1 * swapEthPrice;

  console.log(
    "baseAmount",
    user.getAvailableAmount(54321) / 10 ** DECIMALS_PER_ASSET[54321]
  );
  console.log(
    "quoteAmount",
    user.getAvailableAmount(55555) / 10 ** DECIMALS_PER_ASSET[55555]
  );

  await sendSpotOrder(
    user,
    "Buy",
    3600,
    54321,
    55555,
    baseAmount,
    quoteAmount,
    swapEthPrice,
    0.1,
    null,
    2,
    false,
    null
  );

  await sendSpotOrder(
    user,
    "Sell",
    3600,
    54321,
    55555,
    baseAmount,
    quoteAmount,
    swapEthPrice,
    0.1,
    null,
    2,
    false,
    null
  );
}

async function makeWithdrawal() {
  let privKey = 1234n;
  let user = UserState.fromPrivKey(privKey);

  await user.login();

  // let ethPrivKey =
  //   "0x1da6847600b0ee25e9ad9a52abbd786dd2502fa4005dd5af9310b7cc7a3b25db";
  let withdrawalETHAddress = "0x71CB05EE1b1F506fF321Da3dac38f25c0c9ce6E1";

  console.log(
    "baseAmount",
    user.getAvailableAmount(54321) / 10 ** DECIMALS_PER_ASSET[54321]
  );
  console.log(
    "quoteAmount",
    user.getAvailableAmount(55555) / 10 ** DECIMALS_PER_ASSET[55555]
  );

  await sendWithdrawal(
    user,
    CHAIN_IDS["ETH Mainnet"],
    user.getAvailableAmount(54321) / 10 ** DECIMALS_PER_ASSET[54321],
    54321,
    withdrawalETHAddress
  );

  await sendWithdrawal(
    user,
    CHAIN_IDS["ETH Mainnet"],
    user.getAvailableAmount(55555) / 10 ** DECIMALS_PER_ASSET[55555],
    55555,
    withdrawalETHAddress
  );
}

async function delegatedWithdrawal() {
  const privateKey =
    "0x1da6847600b0ee25e9ad9a52abbd786dd2502fa4005dd5af9310b7cc7a3b25db";
  const wallet = new ethers.Wallet(privateKey);

  const _tokenAddress =
    "0x99F2226cf67E3270701C8eF16349E8e4F398dB2e".toLowerCase();
  const _approvedProxy =
    "0x942Ef51016ddc0CFee3bBbcd42D8FBCc8c7d87F6".toLowerCase();

  // * ERC20 SIGNATURE --------------------------------
  const ercProxyFee = 10000000000000000000n;
  const messageHashErc = ethers.utils.solidityKeccak256(
    ["address", "address", "uint256"],
    [_tokenAddress, _approvedProxy, ercProxyFee]
  );

  const ercSignature = await wallet.signMessage(
    ethers.utils.arrayify(messageHashErc)
  );

  const sig = ethers.utils.splitSignature(ercSignature);
  console.log("erc signature: ", sig.v, sig.r, sig.s);

  // * ETH SIGNATURE --------------------------------
  const ethProxyFee = 10000000000000000n;
  const messageHashEth = ethers.utils.solidityKeccak256(
    ["address", "address", "uint256"],
    ["0x0000000000000000000000000000000000000000", _approvedProxy, ethProxyFee]
  );
  console.log("messageHashEth: ", messageHashEth);

  const ethSignature = await wallet.signMessage(
    ethers.utils.arrayify(messageHashEth)
  );

  const ethSig = ethers.utils.splitSignature(ethSignature);
  console.log("erc signature: ", ethSig.v, ethSig.r, ethSig.s);
}

async function testOpenTab() {
  let privKey = 1234n;
  let user = UserState.fromPrivKey(privKey);

  await user.login();

  let marketId = "12";

  let baseToken = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
  let quoteToken = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

  let baseAmount = user.getAvailableAmount(baseToken);
  let quoteAmount = user.getAvailableAmount(quoteToken);

  await sendOpenOrderTab(user, baseAmount, quoteAmount, marketId, 3600_000);

  console.log(user.orderTabData[0]);
}

async function testRegisterMm() {
  let privKey = 1234n;
  let user = UserState.fromPrivKey(privKey);

  await user.login();

  let marketId = "12";

  let baseToken = SPOT_MARKET_IDS_2_TOKENS[marketId].base;

  let orderTab = user.orderTabData[baseToken][0];

  let vlpToken = 1122334455;
  let maxVlpSupply = 1_000_000;

  console.log("orderTab before register", orderTab);

  await sendRegisterMm(
    user,
    vlpToken,
    maxVlpSupply,
    orderTab.tab_header.pub_key,
    false,
    marketId
  );

  console.log("orderTab after register", orderTab);
}

// makeDeposits();
// makeTestSwaps();
// makeWithdrawal();
// delegatedWithdrawal();
// testOpenTab();
testRegisterMm();

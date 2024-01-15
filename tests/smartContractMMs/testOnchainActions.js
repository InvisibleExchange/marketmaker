const {
  registerMM,
  addLiquidity,
  removeLiquidity,
  closeMM,
} = require("invisible-sdk/src/transactions");
const { UserState } = require("invisible-sdk/src/users");
const { COLLATERAL_TOKEN_DECIMALS } = require("invisible-sdk/src/utils");

async function testRegisterMM() {
  let testPk = "0x44444444444444444444444444444444444444444444444444444444446";

  let marketMaker = await UserState.loginUser(testPk);

  //     /**
  //  * mmAction: {
  //  * mm_owner,
  //  * synthetic_asset,
  //  * position_address,
  //  * max_vlp_supply,
  //  * vlp_token,
  //  * action_id,
  //  * action_type,
  //  */

  let synthetic_asset = 3592681469;
  let position = marketMaker.positionData[synthetic_asset][0];

  let registerAction = {
    mm_owner: "0xe0F30cb149fAADC7247E953746Be9BbBB6B5751f",
    synthetic_asset,
    position_address: position.position_header.position_address,
    max_vlp_supply: 1000000,
    vlp_token: 13579,
    action_id: 1,
    action_type: "register_mm",
  };

  await registerMM(marketMaker, registerAction);
}

async function testAddLiquidity() {
  let testPk = "0x44444444444444444444444444444444444444444444444444444444446";

  let marketMaker = await UserState.loginUser(testPk);

  // /**
  //  * mmAction: {
  //  * depositor,
  //  * position_address,
  //  * usdc_amount,
  //  * action_id,
  //  * action_type,
  //  */

  let synthetic_asset = 3592681469;
  let position = marketMaker.positionData[synthetic_asset][0];

  let addLiqAction = {
    depositor: "0xe0F30cb149fAADC7247E953746Be9BbBB6B5751f",
    position_address: position.position_header.position_address,
    usdc_amount: 100 * 10 ** COLLATERAL_TOKEN_DECIMALS,
    vlp_token: 13579,
    action_id: 2,
    action_type: "add_liquidity",
  };

  await addLiquidity(marketMaker, addLiqAction);
}

async function testRemoveLiquidity() {
  let testPk = "0x44444444444444444444444444444444444444444444444444444444446";

  let marketMaker = await UserState.loginUser(testPk);

  // /**
  //  * mmAction: {
  //  * depositor,
  //  * position_address,
  //  * initial_value,
  //  * vlp_amount,
  //  * action_id,
  //  * action_type,
  //  */

  let synthetic_asset = 3592681469;
  let position = marketMaker.positionData[synthetic_asset][0];

  let removeAction = {
    depositor: "0xe0F30cb149fAADC7247E953746Be9BbBB6B5751f",
    position_address: position.position_header.position_address,
    initial_value: 100 * 10 ** COLLATERAL_TOKEN_DECIMALS,
    vlp_amount: 100 * 10 ** COLLATERAL_TOKEN_DECIMALS,
    action_id: 3,
    action_type: "remove_liquidity",
  };

  await removeLiquidity(marketMaker, removeAction);
}

async function testCloseMM() {
  let testPk = "0x44444444444444444444444444444444444444444444444444444444446";

  let marketMaker = await UserState.loginUser(testPk);

  // /**
  //  * mmAction: {
  //  * mm_owner,
  //  * position_address,
  //  * initial_value_sum,
  //  * vlp_amount_sum,
  //  * action_id,
  //  * action_type,
  //  */

  let synthetic_asset = 3592681469;
  let position = marketMaker.positionData[synthetic_asset][0];

  let closeMMAction = {
    mm_owner: "0xe0F30cb149fAADC7247E953746Be9BbBB6B5751f",
    position_address: position.position_header.position_address,
    initial_value_sum: 0,
    vlp_amount_sum: 0,
    action_id: 4,
    action_type: "close_mm",
  };

  await closeMM(marketMaker, closeMMAction);
}

// testRegisterMM();

// testAddLiquidity();

// testRemoveLiquidity();

testCloseMM();

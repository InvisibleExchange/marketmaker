import { BigNumber } from "ethers";
import {
  sendAddLiquidityUser,
  sendAmendOrder,
  sendCancelOrder,
  sendChangeMargin,
  sendCloseOrderTab,
  sendLiquidationOrder,
  sendModifyOrderTab,
  sendOnChainAddLiquidityMM,
  sendOnChainRemoveLiquidityMM,
  sendOnChainRemoveLiquidityUser,
  sendOpenOrderTab,
  sendPerpOrder,
  sendRegisterMm,
  sendSplitOrder,
  sendSpotOrder,
} from "../transactions/constructOrders";
import UserState from "./Invisibl3User";
import { getActiveOrders } from "../helpers/utils";

type Asset = 12345 | 54321 | 55555;
type SyntheticAsset = 12345 | 54321 | 66666;

/**
 * User class for managing user state and interacting with the system.
 *
 * @class User
 */
class User {
  userSate = UserState;
  activeOrders: {};
  errorCounter: number;

  constructor(userState: typeof UserState) {
    this.userSate = userState;
    this.activeOrders = {}; // TODO: Set active orders?
    this.errorCounter = 0;
  }

  static async initUserState(privKey: string) {
    let userState = UserState.fromPrivKey(BigInt(privKey));

    let { emptyPrivKeys, emptyPositionPrivKeys } = await userState.login();

    let { badOrderIds, orders, badPerpOrderIds, perpOrders, pfrNotes } =
      await getActiveOrders(userState.orderIds, userState.perpetualOrderIds);

    await userState.handleActiveOrders(
      badOrderIds,
      orders,
      badPerpOrderIds,
      perpOrders,
      pfrNotes,
      emptyPrivKeys,
      emptyPositionPrivKeys
    );

    // TODO: Set active Orders?

    return userState;
  }

  async refreshUserState(privKey: string) {
    let userSate = await User.initUserState(privKey);

    this.userSate = userSate;
  }

  async sendSpotOrder(
    orderSide: "Buy" | "Sell",
    expirationTime: number,
    baseToken: Asset,
    quoteToken: Asset,
    baseAmount: number,
    quoteAmount: number,
    price: number,
    feeLimit: number,
    tabAddress: BigNumber,
    slippage: number,
    isMarket: boolean,
    ACTIVE_ORDERS: any
  ) {
    return await sendSpotOrder(
      this.userSate,
      orderSide,
      expirationTime,
      baseToken,
      quoteToken,
      baseAmount,
      quoteAmount,
      price,
      feeLimit,
      tabAddress,
      slippage,
      isMarket,
      this.activeOrders
    );
  }

  async sendPerpOrder(
    orderSide: "Long" | "Short",
    expirationTime: any,
    positionEffectType: "Open" | "Modify" | "Close",
    positionAddress: any,
    syntheticToken: SyntheticAsset,
    syntheticAmount: number,
    price: number,
    initialMargin: number,
    feeLimit: number,
    slippage: number,
    isMarket: any
  ) {
    return await sendPerpOrder(
      this.userSate,
      orderSide,
      expirationTime,
      positionEffectType,
      positionAddress,
      syntheticToken,
      syntheticAmount,
      price,
      initialMargin,
      feeLimit,
      slippage,
      isMarket,
      this.activeOrders
    );
  }

  async sendCancelOrder(
    orderId: number,
    orderSide: "Buy" | "Sell" | "Long" | "Short",
    isPerp: true,
    marketId: number
  ) {
    let isBid =
      (isPerp && orderSide === "Long") || (!isPerp && orderSide === "Buy");

    return await sendCancelOrder(
      this.userSate,
      orderId,
      isBid,
      isPerp,
      marketId,
      this.errorCounter,
      false
    );
  }

  async sendAmendOrder(
    orderId: number,
    orderSide: "Buy" | "Sell" | "Long" | "Short",
    isPerp: boolean,
    marketId: number,
    newPrice: number,
    newExpirationTime: number,
    tabAddress: BigNumber,
    matchOnly: true
  ) {
    let isBid =
      (isPerp && orderSide === "Long") || (!isPerp && orderSide === "Buy");

    return await sendAmendOrder(
      this.userSate,
      orderId,
      isBid,
      isPerp,
      marketId,
      newPrice,
      newExpirationTime,
      tabAddress,
      matchOnly,
      this.activeOrders,
      this.errorCounter
    );
  }

  async sendSplitOrder(token: Asset, newAmounts: number[]) {
    return await sendSplitOrder(this.userSate, token, newAmounts);
  }

  async sendChangeMargin(
    positionAddress: string,
    syntheticToken: SyntheticAsset,
    amount: number,
    direction: "Add" | "Remove"
  ) {
    return await sendChangeMargin(
      this.userSate,
      BigInt(positionAddress),
      syntheticToken,
      amount,
      direction
    );
  }

  async sendLiquidationOrder(
    position: any,
    price: number,
    syntheticToken: SyntheticAsset,
    syntheticAmount: number,
    initial_margin: number,
    slippage: number
  ) {
    return await sendLiquidationOrder(
      this.userSate,
      position,
      price,
      syntheticToken,
      syntheticAmount,
      initial_margin,
      slippage
    );
  }

  async openOrderTab(
    baseAmount: number,
    quoteAmount: number,
    marketId: number
  ) {
    let orderTab = await sendOpenOrderTab(
      this.userSate,
      baseAmount,
      quoteAmount,
      marketId
    );

    return orderTab;
  }

  async closeOrderTab(marketId: number, tabAddress: string) {
    return await sendCloseOrderTab(this.userSate, marketId, BigInt(tabAddress));
  }

  async modifyOrderTab(
    isAdd: any,
    baseAmount: number,
    quoteAmount: number,
    tabAddress: string,
    marketId: number
  ) {
    return await sendModifyOrderTab(
      this.userSate,
      isAdd,
      baseAmount,
      quoteAmount,
      BigInt(tabAddress),
      marketId
    );
  }

  async sendRegisterMm(
    vlpToken: number,
    maxVlpSupply: number,
    posTabAddress: string,
    isPerp: boolean,
    marketId: number
  ) {
    return await sendRegisterMm(
      this.userSate,
      vlpToken,
      maxVlpSupply,
      posTabAddress,
      isPerp,
      marketId
    );
  }

  async sendAddLiquidityUser(
    posTabPubKey: string,
    vLPToken: number,
    baseAmount: number,
    quoteAmount: number,
    collateralAmount: number,
    marketId: number,
    isPerp: boolean
  ) {
    return await sendAddLiquidityUser(
      this.userSate,
      posTabPubKey,
      vLPToken,
      baseAmount,
      quoteAmount,
      collateralAmount,
      marketId,
      isPerp
    );
  }

  async sendOnChainAddLiquidityMM(grpcMessage: any) {
    return await sendOnChainAddLiquidityMM(this.userSate, grpcMessage);
  }

  async sendOnChainRemoveLiquidityUser(
    posTabPubKey: string,
    vlpToken: number,
    indexPrice: number,
    slippage: number,
    marketId: number,
    isPerp: boolean
  ) {
    return await sendOnChainRemoveLiquidityUser(
      this.userSate,
      posTabPubKey,
      vlpToken,
      indexPrice,
      slippage,
      marketId,
      isPerp
    );
  }

  async sendOnChainRemoveLiquidityMM(grpcMessage: any) {
    return await sendOnChainRemoveLiquidityMM(this.userSate, grpcMessage);
  }
}

export default User;

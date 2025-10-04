// Trading logic module with pattern-based decisions

function shouldBuy(token, pattern, config) {
  if (!pattern || !pattern.trading) {
    return false;
  }

  const currentPriceUSD = token.currentPriceUSD;
  const buyThreshold = pattern.trading.buyThresholdUSD;
  
  // Only buy if:
  // 1. Price is above buy threshold
  // 2. Position is not already open
  // 3. Price is above last sell price (avoid immediate re-buy)
  // 4. Under trade count limit
  const maxTradesPerToken = Number(config.trading.maxTradesPerCycle ?? 2);
  const currentTradeCount = Number(token.tradeCount || 0);
  const isFirstBuy = currentTradeCount === 0;
  const reentryAllowed = config.trading.reentryEnabled || isFirstBuy;
  
  return (
    currentPriceUSD >= buyThreshold &&
    !token.positionOpen &&
    currentPriceUSD > (token.lastSellPriceUSD || 0) &&
    currentTradeCount < maxTradesPerToken &&
    reentryAllowed
  );
}

function shouldSell(token, pattern, config) {
  if (!pattern || !pattern.trading || !token.positionOpen) {
    return false;
  }

  const currentPriceUSD = token.currentPriceUSD;
  const buyPriceUSD = token.buyPriceUSD;
  const now = new Date();
  
  if (!buyPriceUSD || buyPriceUSD <= 0) {
    return false;
  }

  // Update peak price tracking
  if (currentPriceUSD > (token.peakPriceSinceLastSell || 0)) {
    token.peakPriceSinceLastSell = currentPriceUSD;
  }

  const tradingParams = pattern.trading;
  
  // Calculate sell thresholds
  const firstSellPrice = buyPriceUSD * (1 + tradingParams.firstSellPercent / 100);
  const secondSellPrice = buyPriceUSD * (1 + tradingParams.secondSellPercent / 100);
  const stopLossPrice = token.peakPriceSinceLastSell * (1 - tradingParams.stopLossFromPeakPercent / 100);
  
  // Check sell conditions
  const sellConditions = {
    firstSell: !token.hasSoldHalf && currentPriceUSD >= firstSellPrice,
    secondSell: currentPriceUSD >= secondSellPrice,
    stopLoss: currentPriceUSD <= stopLossPrice,
    stagnation: token.lastPriceChange && 
      (now.getTime() - token.lastPriceChange.getTime()) / 1000 > tradingParams.priceStagnationTimeoutSeconds
  };

  // Determine sell type
  if (sellConditions.firstSell) {
    return { shouldSell: true, amountMode: 'half', reason: 'first_sell_threshold' };
  }
  
  if (sellConditions.secondSell) {
    return { shouldSell: true, amountMode: 'all', reason: 'second_sell_threshold' };
  }
  
  if (sellConditions.stopLoss) {
    return { shouldSell: true, amountMode: 'all', reason: 'stop_loss' };
  }
  
  if (sellConditions.stagnation) {
    return { shouldSell: true, amountMode: 'all', reason: 'price_stagnation' };
  }

  return false;
}

function getTradingParams(pattern) {
  if (!pattern || !pattern.trading) {
    return null;
  }
  
  return {
    buyThresholdUSD: pattern.trading.buyThresholdUSD,
    sellThresholdUSD: pattern.trading.sellThresholdUSD,
    buyAmountBNB: pattern.trading.buyAmountBNB,
    maxBuyAmountBNB: pattern.trading.maxBuyAmountBNB,
    takeProfitPercent: pattern.trading.takeProfitPercent,
    stopLossPercent: pattern.trading.stopLossPercent,
    firstSellPercent: pattern.trading.firstSellPercent,
    secondSellPercent: pattern.trading.secondSellPercent,
    stopLossFromPeakPercent: pattern.trading.stopLossFromPeakPercent,
    priceStagnationTimeoutSeconds: pattern.trading.priceStagnationTimeoutSeconds
  };
}

module.exports = { shouldBuy, shouldSell, getTradingParams };


// Trading logic module with pattern-based decisions

function shouldBuy(token, pattern, config) {
  if (!pattern || !pattern.trading) {
    return false;
  }

  const currentPriceUSD = token.currentPriceUSD;
  const buyThreshold = pattern.trading.buyPriceThresholdUSD;
  
  // Check buy delay - don't buy immediately after token creation
  const now = new Date();
  const timeSinceCreation = (now.getTime() - token.creationTime.getTime()) / 1000;
  const buyDelaySeconds = pattern.trading.buyDelaySeconds || 0;
  
  if (timeSinceCreation < buyDelaySeconds) {
    return false;
  }
  
  // Prevent too many buy attempts
  const maxBuyAttempts = 3;
  if (token.buyAttempts >= maxBuyAttempts) {
    return false;
  }
  
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
  
  // Calculate sell thresholds using your pattern format
  const firstSellPrice = buyPriceUSD * (1 + tradingParams.firstSellThresholdPercent / 100);
  const secondSellPrice = buyPriceUSD * (1 + tradingParams.secondSellThresholdPercent / 100);
  const stopLossPrice = token.peakPriceSinceLastSell * (1 - tradingParams.stopLossFromPeakPercent / 100);
  
  // Check hold time - don't sell too quickly
  const timeSinceBuy = token.buyTime ? (now.getTime() - token.buyTime.getTime()) / 1000 : 0;
  const minHoldTime = tradingParams.holdTimeSeconds || 0;
  
  // Check sell conditions
  const sellConditions = {
    firstSell: !token.hasSoldHalf && currentPriceUSD >= firstSellPrice && timeSinceBuy >= minHoldTime,
    secondSell: currentPriceUSD >= secondSellPrice && timeSinceBuy >= minHoldTime,
    stopLoss: currentPriceUSD <= stopLossPrice,
    stagnation: token.lastPriceChange && 
      (now.getTime() - token.lastPriceChange.getTime()) / 1000 > tradingParams.priceStagnationTimeoutSeconds,
    longTermStagnation: token.lastPriceChange && 
      (now.getTime() - token.lastPriceChange.getTime()) / 1000 > tradingParams.longTermStagnationTimeoutSeconds
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
  
  if (sellConditions.longTermStagnation) {
    return { shouldSell: true, amountMode: 'all', reason: 'long_term_stagnation' };
  }

  return false;
}

function getTradingParams(pattern) {
  if (!pattern || !pattern.trading) {
    return null;
  }
  
  return {
    buyPriceThresholdUSD: pattern.trading.buyPriceThresholdUSD,
    buyAmount: pattern.trading.buyAmount,
    holdTimeSeconds: pattern.trading.holdTimeSeconds,
    maxSlippage: pattern.trading.maxSlippage,
    stopLossPercent: pattern.trading.stopLossPercent,
    takeProfitPercent: pattern.trading.takeProfitPercent,
    buyDelaySeconds: pattern.trading.buyDelaySeconds,
    firstSellThresholdPercent: pattern.trading.firstSellThresholdPercent,
    secondSellThresholdPercent: pattern.trading.secondSellThresholdPercent,
    stopLossFromPeakPercent: pattern.trading.stopLossFromPeakPercent,
    priceStagnationTimeoutSeconds: pattern.trading.priceStagnationTimeoutSeconds,
    longTermStagnationTimeoutSeconds: pattern.trading.longTermStagnationTimeoutSeconds
  };
}

module.exports = { shouldBuy, shouldSell, getTradingParams };


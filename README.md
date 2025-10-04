# 🚀 Price-Based Trading Bot for Four.Meme

A clean, focused trading bot that monitors ALL newly created tokens on the four.meme platform and executes trades based on price thresholds.

## 🎯 **What This Bot Does**

- **Monitors ALL newly created tokens** on four.meme (not just pattern-matched ones)
- **Buys tokens when price exceeds low threshold** ($0.00003 USD by default)
- **Sells tokens when price exceeds high threshold** ($0.00009 USD by default)
- **Automatically manages monitoring list** (adds new tokens, removes inactive ones)
- **Avoids migration dumps** by selling before migration price

## 📁 **Project Structure**

```
Price_limit_Bot/
├── simplePriceBasedTradingService.js  # Main trading service
├── price-trading-bot.js              # Main bot application
├── price-trading-config.json         # Configuration file
├── test-price-trading.js             # Test script
├── add-wallets.js                    # Wallet configuration helper
├── start-price-trading.sh            # Startup script
├── PRICE_BASED_TRADING_README.md     # Detailed documentation
├── package.json                      # Dependencies
└── node_modules/                     # Installed packages
```

## 🚀 **Quick Start**

### **1. Test the System**
```bash
node test-price-trading.js
```

### **2. Add Your Wallets**
```bash
node add-wallets.js
```
Then edit `simplePriceBasedTradingService.js` and add your wallet addresses in the `loadAvailableWallets()` method.

### **3. Configure Settings**
Edit `price-trading-config.json`:
```json
{
  "trading": {
    "enabled": true,
    "testMode": true,
    "lowThresholdUSD": 0.00003,
    "highThresholdUSD": 0.00009,
    "migrationPriceUSD": 0.0000884,
    "buyAmountBNB": 0.001
  }
}
```

### **4. Start Trading**
```bash
node price-trading-bot.js
```

## ⚙️ **Configuration**

### **Trading Settings:**
- `enabled`: Enable/disable trading
- `testMode`: Test mode (no real trades)
- `lowThresholdUSD`: Buy threshold in USD
- `highThresholdUSD`: Sell threshold in USD
- `migrationPriceUSD`: Migration price in USD
- `buyAmountBNB`: BNB amount per trade

### **Monitoring Settings:**
- `updateIntervalMs`: Price update interval (1000ms = 1 second)
- `inactiveTimeoutMinutes`: Remove inactive tokens after X minutes (30)
- `maxConcurrentTokens`: Maximum tokens to monitor (200)

## 📊 **How It Works**

1. **Token Discovery**: Scans BSC blocks for four.meme token creations
2. **Price Monitoring**: Updates prices every 1 second for active tokens
3. **Threshold Checking**: Compares current price with your thresholds
4. **Trading Execution**: Buys/sells when thresholds are met
5. **Cleanup**: Removes tokens after 30 minutes of inactivity

## 🎯 **Your Trading Strategy**

- **Buy Low**: Buy when price > $0.00003 USD
- **Sell High**: Sell when price > $0.00009 USD
- **Avoid Migration**: Emergency sell before migration price
- **Target Profit**: Hundreds of profit per trade

## 📈 **Monitoring**

The bot displays real-time status updates every 30 seconds:
- Tokens currently monitored
- Trading statistics (buys, sells, profit)
- Recent token activity with price changes
- System uptime and performance

## 🚨 **Important Notes**

- **Test First**: Always run in test mode first
- **Add Wallets**: Configure your wallet addresses
- **Start Small**: Begin with small buy amounts
- **Monitor Closely**: Watch the first few trades
- **Keep Private Keys Secure**: Never share your private keys

## 📚 **Documentation**

For detailed documentation, see `PRICE_BASED_TRADING_README.md`.

## 🎉 **Ready to Trade!**

Your price-based trading bot is ready! Start with testing, add your wallets, configure your thresholds, and begin trading for hundreds of profit per trade! 🚀

---

*Remember: This is a high-risk trading system. Only trade with money you can afford to lose.*



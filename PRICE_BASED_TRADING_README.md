# 🚀 Price-Based Trading Bot for Four.Meme

A sophisticated trading bot that monitors ALL newly created tokens on the four.meme platform and executes trades based on price thresholds.

## 🎯 **What This Bot Does**

### **Core Functionality:**
1. **Universal Token Monitoring**: Scans every new token creation on four.meme (not just pattern-matched ones)
2. **Price-Based Trading**: Buys tokens when price exceeds low threshold, sells when price exceeds high threshold
3. **Smart Token Management**: Automatically removes tokens from monitoring after 30 minutes of inactivity or after successful trades
4. **Migration Protection**: Sells tokens before they reach migration price to avoid post-migration dumps

### **Your Trading Strategy:**
- **Buy Low**: Buy tokens when price exceeds $0.00002 USD (configurable)
- **Sell High**: Sell tokens when price exceeds $0.00008 USD (configurable)  
- **Avoid Migration**: Emergency sell before migration price ($0.0000884 USD)
- **Profit Target**: Hundreds of profit per trade by catching price movements early

## 📊 **Key Features**

### **✅ Implemented Features:**
- ✅ **Real-time Token Discovery**: Monitors ALL four.meme token creations
- ✅ **Price Monitoring**: Updates prices every 1 second for active tokens
- ✅ **Threshold-Based Trading**: Buy/sell based on your price thresholds
- ✅ **Smart Cleanup**: Removes inactive tokens after 30 minutes
- ✅ **Test Mode**: Safe simulation without real money
- ✅ **Configuration System**: Easy to modify thresholds and settings
- ✅ **Multi-wallet Support**: Uses all available wallets for trading
- ✅ **Comprehensive Logging**: Detailed logs of all activities

### **🔧 Configuration Options:**
- **Low Threshold**: $0.00002 USD (when to buy)
- **High Threshold**: $0.00008 USD (when to sell)
- **Migration Price**: $0.0000884 USD (emergency sell)
- **Buy Amount**: 0.001 BNB per trade
- **Update Interval**: 1000ms (1 second)
- **Inactive Timeout**: 30 minutes
- **Max Concurrent Tokens**: 200

## 🚀 **Quick Start**

### **1. Test the System (Recommended First)**
```bash
# Test basic functionality
node test-price-trading.js
```

### **2. Configure Your Settings**
Edit `price-trading-config.json`:
```json
{
  "trading": {
    "enabled": true,           // Set to true to start trading
    "testMode": true,          // Set to false for real trading
    "lowThresholdUSD": 0.00002, // Your buy threshold
    "highThresholdUSD": 0.00008, // Your sell threshold
    "migrationPriceUSD": 0.0000884,
    "buyAmountBNB": 0.001      // Amount per trade
  }
}
```

### **3. Add Your Wallets**
Edit `simplePriceBasedTradingService.js` and add your wallet addresses in the `loadAvailableWallets()` method:
```javascript
this.availableWallets = [
  '0x1234567890123456789012345678901234567890', // Your wallet 1
  '0x0987654321098765432109876543210987654321'  // Your wallet 2
];
```

### **4. Start Trading**
```bash
# Start the price-based trading bot
node price-trading-bot.js

# Or use the startup script
./start-price-trading.sh
```

## 📈 **How It Works**

### **Token Discovery Process:**
1. **Block Scanning**: Monitors BSC blocks every 500ms for new transactions
2. **Four.Meme Detection**: Identifies transactions to four.meme contract
3. **Token Extraction**: Extracts token address from transaction logs
4. **Price Fetching**: Gets initial price using four.meme contract simulation
5. **Monitoring Start**: Adds token to monitoring list

### **Price Monitoring Process:**
1. **Price Updates**: Updates prices every 1 second for all monitored tokens
2. **Threshold Checking**: Compares current price with your thresholds
3. **Trading Execution**: Executes buy/sell orders when thresholds are met
4. **Cleanup**: Removes tokens after 30 minutes of inactivity or after trades

### **Trading Logic:**
```
Token Created → Price Monitoring → Price Check → Action
                                    ↓
                              Price > Low Threshold? → BUY
                                    ↓
                              Price > High Threshold? → SELL
                                    ↓
                              Price > Migration Price? → EMERGENCY SELL
```

## 🎛️ **Configuration Details**

### **Trading Settings:**
```json
{
  "trading": {
    "enabled": false,              // Enable/disable trading
    "testMode": true,              // Test mode (no real trades)
    "lowThresholdUSD": 0.00002,     // Buy threshold in USD
    "highThresholdUSD": 0.00008,   // Sell threshold in USD
    "migrationPriceUSD": 0.0000884, // Migration price in USD
    "buyAmountBNB": 0.001,         // BNB amount per trade
    "maxBuyAmountBNB": 0.01,       // Maximum BNB per trade
    "userId": "main-trader"        // User identifier
  }
}
```

### **Monitoring Settings:**
```json
{
  "monitoring": {
    "updateIntervalMs": 1000,      // Price update interval (ms)
    "inactiveTimeoutMinutes": 30,  // Remove inactive tokens after X minutes
    "maxConcurrentTokens": 200,    // Maximum tokens to monitor
    "priceChangeThreshold": 0.000001 // Minimum price change to track
  }
}
```

### **Safety Settings:**
```json
{
  "safety": {
    "maxTradesPerHour": 50,        // Maximum trades per hour
    "maxTradesPerDay": 200,        // Maximum trades per day
    "emergencyStop": false,        // Emergency stop switch
    "minWalletBalanceBNB": 0.01    // Minimum wallet balance
  }
}
```

## 📊 **Monitoring & Statistics**

### **Real-time Status Updates:**
The bot displays status updates every 30 seconds showing:
- Uptime and current activity
- Number of tokens being monitored
- Trading statistics (buys, sells, profit)
- Recent token activity with price changes

### **Trading Statistics:**
- Total trades executed
- Successful buys/sells
- Total profit/loss in USD
- Tokens monitored vs traded
- Success rate percentage

### **Example Output:**
```
📈 Trading Status Update:
   Uptime: 2h 15m 30s
   Tokens Monitored: 45
   Total Trades: 12
   Successful Buys: 8
   Successful Sells: 6
   Total Profit: $0.000045
   Available Wallets: 3

🎯 Recent Token Activity:
   ✅ 0x12345678... $0.00002345 📈 +15.2%
   ⏳ 0x87654321... $0.00001567 📉 -5.8%
   ✅ 0xabcdef12... $0.00008901 📈 +45.3%
```

## 🔧 **Technical Details**

### **Architecture:**
- **Token Scanner**: Monitors BSC blocks for four.meme transactions
- **Price Service**: Fetches real-time prices using four.meme contract
- **Trading Engine**: Executes buy/sell orders based on thresholds
- **Monitoring Manager**: Manages token lifecycle and cleanup

### **Key Components:**
- `simplePriceBasedTradingService.js` - Main trading service
- `price-trading-bot.js` - Main bot application
- `price-trading-config.json` - Configuration file
- `test-price-trading.js` - Test script

### **Dependencies:**
- `viem` - Ethereum library for blockchain interactions
- `bsc` - Binance Smart Chain configuration
- Node.js 18+ - Runtime environment

## 🚨 **Important Notes**

### **Before Live Trading:**
1. **Test First**: Always run in test mode first
2. **Add Wallets**: Configure your wallet addresses
3. **Set Thresholds**: Adjust price thresholds for your strategy
4. **Monitor Closely**: Watch the first few trades carefully
5. **Start Small**: Begin with small buy amounts

### **Risk Management:**
- **Test Mode**: Use test mode to verify functionality
- **Small Amounts**: Start with small buy amounts
- **Monitor Activity**: Watch logs and status updates
- **Emergency Stop**: Use emergency stop if needed
- **Wallet Security**: Keep your private keys secure

### **Performance Considerations:**
- **Token Limit**: Monitors up to 200 tokens simultaneously
- **Update Frequency**: 1-second price updates for active tokens
- **Cleanup**: Automatic removal of inactive tokens
- **Resource Usage**: Minimal CPU and memory usage

## 🐛 **Troubleshooting**

### **Common Issues:**

1. **No Wallets Found**
   - Add wallet addresses to `loadAvailableWallets()` method
   - Ensure wallets have sufficient BNB balance

2. **Trading Disabled**
   - Set `"enabled": true` in configuration
   - Check if test mode is appropriate

3. **No Tokens Being Monitored**
   - Check BSC RPC connection
   - Verify four.meme contract address
   - Check block scanning logs

4. **Price Fetching Errors**
   - Verify token contract is valid
   - Check four.meme contract availability
   - Monitor network connectivity

### **Debug Commands:**
```bash
# Test configuration
node test-price-trading.js

# Check logs
tail -f logs/price-trading.log

# Monitor status
# Status updates appear every 30 seconds in console
```

## 🎉 **Success!**

Your new price-based trading system is ready! This system will:

✅ **Monitor ALL newly created tokens** on four.meme platform  
✅ **Buy tokens when price exceeds your low threshold** ($0.00002)  
✅ **Sell tokens when price exceeds your high threshold** ($0.00008)  
✅ **Avoid migration dumps** by selling before migration price  
✅ **Automatically manage monitoring list** (adds new, removes inactive)  
✅ **Provide comprehensive logging and monitoring**  
✅ **Support multiple wallets for trading**  

**Next Steps:**
1. Add your wallet addresses
2. Test the system thoroughly
3. Start with small amounts
4. Monitor performance closely
5. Adjust thresholds as needed

**Happy Trading! 🚀**

---

*Remember: This is a high-risk trading system. Only trade with money you can afford to lose. Always test thoroughly before live trading.*



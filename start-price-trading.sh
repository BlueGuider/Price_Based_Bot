#!/bin/bash

# Price-Based Trading Bot Startup Script
# This script starts the new price-based trading system

echo "🚀 Starting Price-Based Trading Bot..."
echo "======================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if the project is built
if [ ! -d "dist" ]; then
    echo "📦 Building the project..."
    npm run build
    if [ $? -ne 0 ]; then
        echo "❌ Build failed. Please check the errors above."
        exit 1
    fi
fi

# Check if configuration file exists
if [ ! -f "price-trading-config.json" ]; then
    echo "⚠️ Configuration file not found. Using default configuration."
fi

# Check if environment variables are set
if [ -z "$BSC_RPC_URL" ]; then
    echo "⚠️ BSC_RPC_URL not set. Using default BSC RPC."
    export BSC_RPC_URL="https://bsc-dataseed.binance.org"
fi

# Start the price-based trading bot
echo "🎯 Starting price-based trading system..."
node price-trading-bot.js




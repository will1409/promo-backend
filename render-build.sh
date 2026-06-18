#!/usr/bin/env bash
# exit on error
set -o errexit

echo "Running standard npm install..."
npm install

echo "Installing Playwright OS dependencies..."
npx playwright install-deps

echo "Installing Playwright Chromium browser..."
npx playwright install chromium

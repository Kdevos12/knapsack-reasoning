#!/usr/bin/env node
/**
 * Run the measurement harness to audit ramp constants.
 * Usage: node scripts/runHarness.js
 */

// Import compiled JavaScript from dist
const path = require('path');
const { auditRampConstants } = require(path.join(__dirname, '..', 'dist', 'measurementHarness.js'));

if (auditRampConstants) {
  auditRampConstants();
} else {
  console.error('Failed to load harness. Did you run `npm run build` first?');
  process.exit(1);
}

import { describe, it } from 'mocha';
import { expect } from 'chai';

// Test both import styles to ensure compatibility
describe('Puppeteer Import Compatibility Tests', () => {
  it('should support namespace import with puppeteer', () => {
    // This is the new import style we're using
    const puppeteerModule = require('puppeteer');
    expect(puppeteerModule).to.be.an('object');
    expect(puppeteerModule.launch).to.be.a('function');
    expect(puppeteerModule.connect).to.be.a('function');
  });

  it('should support destructured imports from puppeteer', () => {
    // Ensure destructured imports still work
    const { launch, connect } = require('puppeteer');
    expect(launch).to.be.a('function');
    expect(connect).to.be.a('function');
  });

  it('should support HTTPRequest import from puppeteer', () => {
    // Test that HTTPRequest type is available
    const puppeteerModule = require('puppeteer');
    // Just check if it exists - TypeScript will handle the actual type checking
    expect(puppeteerModule).to.have.property('HTTPRequest');
  });
});
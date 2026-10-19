// Preloaded by run-browser.mjs (node --import): under a parallel run on SwiftShader a page takes several times longer to boot,
// so Playwright's 30 s default (goto, waitForFunction, ...) times out although nothing is wrong. Every page gets a longer default.
import { chromium } from 'playwright';

const TIMEOUT = 120000;
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...a) => {
  const browser = await launch(...a);
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...b) => {
    const page = await newPage(...b);
    page.setDefaultTimeout(TIMEOUT);
    return page;
  };
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...b) => {
    const ctx = await newContext(...b);
    ctx.setDefaultTimeout(TIMEOUT);
    return ctx;
  };
  return browser;
};

/**
 * BrowserDiscovery — locate an installed Chromium-based browser on the host.
 *
 * puppeteer-core does not ship a bundled browser (that's puppeteer's job),
 * so the caller must supply an executablePath. Sprint 2 keeps the repo lean
 * by reusing whatever Chromium-based browser the developer already has.
 *
 * Resolution order:
 *   1. CHROME_PATH env var (explicit override)
 *   2. Common Chrome install locations (Program Files, Program Files (x86),
 *      LocalAppData)
 *   3. Common Edge install locations — Edge is Chromium-based and works
 *      with puppeteer-core unmodified
 *
 * Throws a helpful error if nothing is found.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverBrowser = discoverBrowser;
const fs = require("fs");
const path = require("path");
const WINDOWS_CHROME_CANDIDATES = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];
const WINDOWS_EDGE_CANDIDATES = [
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];
function discoverBrowser(envOverride) {
    // 1. Explicit override
    const envVal = envOverride ?? process.env.CHROME_PATH;
    if (envVal && fs.existsSync(envVal)) {
        return {
            executablePath: envVal,
            product: envVal.toLowerCase().includes('msedge') ? 'edge' : 'chrome',
            source: 'env'
        };
    }
    const localAppData = process.env.LOCALAPPDATA;
    const userChrome = localAppData
        ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : null;
    const chromeCandidates = userChrome
        ? [userChrome, ...WINDOWS_CHROME_CANDIDATES]
        : WINDOWS_CHROME_CANDIDATES;
    // 2. Chrome installs
    for (const candidate of chromeCandidates) {
        if (fs.existsSync(candidate)) {
            return { executablePath: candidate, product: 'chrome', source: 'chrome-install' };
        }
    }
    // 3. Edge installs
    for (const candidate of WINDOWS_EDGE_CANDIDATES) {
        if (fs.existsSync(candidate)) {
            return { executablePath: candidate, product: 'edge', source: 'edge-install' };
        }
    }
    throw new Error('No Chromium-based browser found. Set CHROME_PATH to chrome.exe or msedge.exe, ' +
        'or install Google Chrome / Microsoft Edge in their default location.');
}
//# sourceMappingURL=BrowserDiscovery.js.map
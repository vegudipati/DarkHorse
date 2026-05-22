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
export interface DiscoveredBrowser {
    executablePath: string;
    product: 'chrome' | 'edge';
    source: 'env' | 'chrome-install' | 'edge-install';
}
export declare function discoverBrowser(envOverride?: string): DiscoveredBrowser;
//# sourceMappingURL=BrowserDiscovery.d.ts.map
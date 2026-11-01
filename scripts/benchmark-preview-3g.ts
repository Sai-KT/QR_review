/**
 * Production Preview 3G Benchmark Script (M3-T05)
 *
 * Verifies production build performance on simulated 3G networks:
 * 1. Spawns Vite preview server on 127.0.0.1:4173 with local demo env.
 * 2. Emulates Fast 3G and Regular 3G using Chrome DevTools Protocol (CDP).
 * 3. Tests valid salon (/q/luxe000001) and cafe (/q/daily00001) welcome routes.
 * 4. Measures time until merchant heading and direct Google review action are visible.
 * 5. Separates frontend resource loading from Supabase resolver latency.
 * 6. Records cold-load median, min, and worst-case timings.
 * 7. Verifies zero browser console errors.
 *
 * Run via: node --experimental-strip-types scripts/benchmark-preview-3g.ts
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type CDPSession } from '@playwright/test';
import { performSafeLocalRateLimitReset } from '../tests/e2e/test-isolation.ts';

interface NetworkProfile {
  name: string;
  downloadThroughput: number; // bytes/sec
  uploadThroughput: number;   // bytes/sec
  latency: number;            // ms RTT
  description: string;
}

const PROFILES: Record<string, NetworkProfile> = {
  FAST_3G: {
    name: 'Fast 3G',
    downloadThroughput: (1.6 * 1024 * 1024) / 8, // 1.6 Mbps = 204,800 B/s
    uploadThroughput: (750 * 1024) / 8,          // 750 kbps = 96,000 B/s
    latency: 150,                                // 150ms round-trip
    description: '1.6 Mbps down, 750 kbps up, 150ms RTT',
  },
  REGULAR_3G: {
    name: 'Regular 3G (Slow 3G)',
    downloadThroughput: (750 * 1024) / 8,        // 750 kbps = 96,000 B/s
    uploadThroughput: (250 * 1024) / 8,          // 250 kbps = 32,000 B/s
    latency: 300,                                // 300ms round-trip
    description: '750 kbps down, 250 kbps up, 300ms RTT',
  },
  FAST_4G: {
    name: '4G LTE (Reference)',
    downloadThroughput: (10 * 1024 * 1024) / 8,  // 10 Mbps = 1,280,000 B/s
    uploadThroughput: (3 * 1024 * 1024) / 8,     // 3 Mbps = 384,000 B/s
    latency: 40,                                 // 40ms round-trip
    description: '10 Mbps down, 3 Mbps up, 40ms RTT',
  },
};

interface TestRoute {
  category: 'salon' | 'cafe';
  name: string;
  expectedHeading: string;
  path: string;
}

const TEST_ROUTES: TestRoute[] = [
  {
    category: 'salon',
    name: 'Luxe Studio Unisex Salon',
    expectedHeading: 'Luxe Studio Unisex Salon',
    path: '/q/luxe000001',
  },
  {
    category: 'cafe',
    name: 'The Daily Roast Cafe',
    expectedHeading: 'The Daily Roast Cafe',
    path: '/q/daily00001',
  },
];

interface IterationResult {
  route: string;
  category: string;
  profile: string;
  runIndex: number;
  totalTimeMs: number;
  merchantVisibleMs: number;
  googleActionVisibleMs: number;
  domContentLoadedMs: number;
  frontendAssetsTimeMs: number;
  resolverDurationMs: number;
  resolverResponseSize: number;
  totalTransferredBytes: number;
  consoleErrors: string[];
}

const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404 || res.status === 200) {
        return;
      }
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for server at ${url}`);
}

async function runIteration(
  browser: Browser,
  route: TestRoute,
  profile: NetworkProfile,
  runIndex: number,
): Promise<IterationResult> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // Mobile viewport (iPhone 13 / Pixel)
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();
  const consoleErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Exclude simulated unresolvable test seed domain images (e.g. https://local.test/*)
      if (text.includes('local.test') || text.includes('ERR_NAME_NOT_RESOLVED')) {
        return;
      }
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  // Attach Chrome DevTools Protocol session
  const cdp: CDPSession = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: profile.downloadThroughput,
    uploadThroughput: profile.uploadThroughput,
    latency: profile.latency,
  });

  let resolverStartTime = 0;
  let resolverEndTime = 0;
  let resolverDurationMs = 0;
  let resolverResponseSize = 0;
  let frontendAssetsEndTime = 0;
  let totalTransferredBytes = 0;
  let resolverRequestId = '';

  cdp.on('Network.requestWillBeSent', (event) => {
    if (event.request.url.includes('/functions/v1/get-public-business')) {
      resolverRequestId = event.requestId;
      resolverStartTime = performance.now();
    }
  });

  cdp.on('Network.responseReceived', (event) => {
    if (
      event.requestId === resolverRequestId ||
      event.response.url.includes('/functions/v1/get-public-business')
    ) {
      resolverEndTime = performance.now();
      resolverDurationMs = Math.round(resolverEndTime - (resolverStartTime || navStart));
      if (event.response.timing) {
        // Precise duration from Chrome DevTools Protocol timing if available
        const t = event.response.timing;
        if (t.receiveHeadersEnd && t.sendStart) {
          resolverDurationMs = Math.round(t.receiveHeadersEnd - t.sendStart);
        }
      }
    }
  });

  cdp.on('Network.loadingFinished', (event) => {
    totalTransferredBytes += event.encodedDataLength || 0;
    if (event.requestId === resolverRequestId) {
      resolverResponseSize = event.encodedDataLength || 0;
    }
    if (!frontendAssetsEndTime && totalTransferredBytes > 100000) {
      frontendAssetsEndTime = performance.now();
    }
  });

  const navStart = performance.now();
  await page.goto(`${PREVIEW_URL}${route.path}`, { waitUntil: 'domcontentloaded' });
  const domContentLoadedMs = Math.round(performance.now() - navStart);

    // Measure time until merchant name is visible
    const merchantLocator = page.getByRole('heading', { name: route.expectedHeading });
    try {
      await merchantLocator.waitFor({ state: 'visible', timeout: 35000 });
    } catch (e) {
      const pageText = await page.locator('body').innerText().catch(() => 'unable to read body');
      console.error(`Locator wait failed for heading "${route.expectedHeading}". Page text:\n${pageText}`);
      throw e;
    }
    const merchantVisibleMs = Math.round(performance.now() - navStart);

  // Measure time until direct Google review bypass button is visible
  const googleActionLocator = page.getByRole('button', {
    name: /Review Directly on Google Maps|Search on Google Maps/i,
  });
  await googleActionLocator.waitFor({ state: 'visible', timeout: 35000 });
  const googleActionVisibleMs = Math.round(performance.now() - navStart);

  const totalTimeMs = Math.max(merchantVisibleMs, googleActionVisibleMs);
  const frontendAssetsTimeMs = frontendAssetsEndTime
    ? Math.round(frontendAssetsEndTime - navStart)
    : domContentLoadedMs;

  await cdp.detach();
  await context.close();

  return {
    route: route.path,
    category: route.category,
    profile: profile.name,
    runIndex,
    totalTimeMs,
    merchantVisibleMs,
    googleActionVisibleMs,
    domContentLoadedMs,
    frontendAssetsTimeMs,
    resolverDurationMs: resolverDurationMs || 0,
    resolverResponseSize,
    totalTransferredBytes,
    consoleErrors,
  };
}

function calculateStats(values: number[]): { min: number; median: number; max: number; avg: number } {
  if (values.length === 0) return { min: 0, median: 0, max: 0, avg: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  const avg = Math.round(sorted.reduce((acc, v) => acc + v, 0) / sorted.length);
  return { min, median, max, avg };
}

async function main() {
  console.log('================================================================');
  console.log('  M3-T05 PRODUCTION PREVIEW 3G BENCHMARK');
  console.log('================================================================');
  console.log(`Node: ${process.version} | Target Preview URL: ${PREVIEW_URL}`);

  // 1. Reset local test rate limits for runner
  console.log('\n[1/5] Performing safe local rate-limit reset for benchmark runner...');
  const resetRes = await performSafeLocalRateLimitReset();
  if (resetRes.success) {
    console.log('✓ Local test rate-limit buckets safely reset.');
  } else {
    console.warn(`[Preflight notice] ${resetRes.reason}`);
  }

  // 2. Launch Vite preview server
  console.log('\n[2/5] Spawning Vite preview server on 127.0.0.1:4173...');
  const previewProcess: ChildProcess = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PREVIEW_PORT), '--strictPort'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
        VITE_SUPABASE_ANON_KEY:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
      },
    },
  );

  // preview server stdout/stderr
  previewProcess.stderr?.on('data', (d) => {
    console.error(`[Preview stderr] ${d.toString().trim()}`);
  });

  try {
    await waitForServer(PREVIEW_URL);
    console.log('✓ Vite preview server is ready and responding at', PREVIEW_URL);

    // 3. Launch Chromium browser
    console.log('\n[3/5] Launching headless Chromium with CDP...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const allResults: IterationResult[] = [];

    // 4. Execute Benchmarks
    console.log('\n[4/5] Running repeated cold-load benchmarks...');
    const testProfiles = [PROFILES.FAST_3G!, PROFILES.REGULAR_3G!, PROFILES.FAST_4G!];

    for (const profile of testProfiles) {
      console.log(`\n--- Profile: ${profile.name} (${profile.description}) ---`);
      for (const route of TEST_ROUTES) {
        console.log(`  Target: ${route.name} (${route.path})`);
        const iterations = 3;
        for (let i = 1; i <= iterations; i++) {
          const res = await runIteration(browser, route, profile, i);
          allResults.push(res);
          console.log(
            `    Run ${i}: DOM=${res.domContentLoadedMs}ms | Merchant=${res.merchantVisibleMs}ms | GoogleBtn=${res.googleActionVisibleMs}ms | Total=${res.totalTimeMs}ms | Resolver=${res.resolverDurationMs}ms | Transferred=${Math.round(res.totalTransferredBytes / 1024)}kB | Errors=${res.consoleErrors.length}`,
          );
        }
      }
    }

    await browser.close();

    // 5. Summarize and Analyze
    console.log('\n[5/5] BENCHMARK RESULTS SUMMARY:');
    console.log('================================================================');

    for (const profile of testProfiles) {
      console.log(`\n### Profile: ${profile.name} (${profile.description})`);
      const profileResults = allResults.filter((r) => r.profile === profile.name);

      for (const route of TEST_ROUTES) {
        const routeResults = profileResults.filter((r) => r.route === route.path);
        const merchantTimes = routeResults.map((r) => r.merchantVisibleMs);
        const googleTimes = routeResults.map((r) => r.googleActionVisibleMs);
        const resolverTimes = routeResults.map((r) => r.resolverDurationMs);
        const domTimes = routeResults.map((r) => r.domContentLoadedMs);

        const merchantStats = calculateStats(merchantTimes);
        const googleStats = calculateStats(googleTimes);
        const resolverStats = calculateStats(resolverTimes);
        const domStats = calculateStats(domTimes);

        console.log(`\n  Route: ${route.name} (${route.path})`);
        console.log(`    - DOMContentLoaded:     Median=${domStats.median}ms, Min=${domStats.min}ms, Max=${domStats.max}ms`);
        console.log(`    - Merchant Heading:     Median=${merchantStats.median}ms, Min=${merchantStats.min}ms, Worst=${merchantStats.max}ms`);
        console.log(`    - Direct Google Action: Median=${googleStats.median}ms, Min=${googleStats.min}ms, Worst=${googleStats.max}ms`);
        console.log(`    - Supabase Resolver:    Median=${resolverStats.median}ms, Min=${resolverStats.min}ms, Max=${resolverStats.max}ms`);
        console.log(`    - 1.5s Target Status:   ${merchantStats.median <= 1500 ? 'PASS (<= 1500ms)' : 'FAILS TARGET (> 1500ms)'}`);
      }
    }

    // Console errors summary
    const totalConsoleErrors = allResults.reduce((acc, r) => acc + r.consoleErrors.length, 0);
    console.log(`\nTotal Browser Console Errors across all runs: ${totalConsoleErrors}`);
    if (totalConsoleErrors > 0) {
      const uniqueErrors = Array.from(new Set(allResults.flatMap((r) => r.consoleErrors)));
      console.error('Errors observed:', uniqueErrors);
    }

    console.log('\n================================================================');
  } finally {
    console.log('Stopping preview server...');
    previewProcess.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('Benchmark execution failed:', err);
  process.exit(1);
});


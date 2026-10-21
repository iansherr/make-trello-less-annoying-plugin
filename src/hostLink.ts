/**
 * Detecting the ikmal webtools host. This plugin also ships as a standalone extension, where the features below
 * (Cards-page dashboard, board export, page fixes) have never run; they start only inside the ikmal host, which
 * announces itself (contract, host repo docs/PLUGIN_CONTRACT.md). Content scripts load in either order, so this
 * handles both: the host may already be there, or announce itself later.
 */
const HOST_KEY = '__ikmalHost';
const HOST_READY_EVENT = 'ikmal:host-ready';

export function whenIkmalHost(start: () => void): void {
  if ((window as unknown as Record<string, unknown>)[HOST_KEY]) {
    start();
    return;
  }
  window.addEventListener(HOST_READY_EVENT, start, { once: true });
}

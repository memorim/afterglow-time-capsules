// drand Quicknet publishes one round every three seconds starting at genesis.
export const chainHash = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
export function releaseRound(unlockAt) {
  return Math.ceil((Date.parse(unlockAt) - 1692803367000) / 3000) + 1;
}

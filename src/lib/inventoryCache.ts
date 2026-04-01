const INVENTORY_CACHE_TTL_MS = 2000;

let inventoryCache: { expiresAt: number; payload: unknown[] } | null = null;

export function invalidateInventoryCache(): void {
  inventoryCache = null;
}

export function getInventoryCachePayloadIfFresh(): unknown[] | null {
  if (inventoryCache && inventoryCache.expiresAt > Date.now()) {
    return inventoryCache.payload;
  }
  return null;
}

export function setInventoryCachePayload(payload: unknown[]): void {
  inventoryCache = {
    expiresAt: Date.now() + INVENTORY_CACHE_TTL_MS,
    payload,
  };
}

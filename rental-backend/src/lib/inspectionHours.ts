import { prisma } from "./prisma.js";

export async function getCurrentInventoryHours(inventoryId: string) {
  const row = await prisma.inventory.findUnique({
    where: { id: inventoryId },
    select: { hours: true },
  });
  if (!row) return null;
  if (typeof row.hours !== "number" || !Number.isFinite(row.hours)) return null;
  return Number(row.hours);
}

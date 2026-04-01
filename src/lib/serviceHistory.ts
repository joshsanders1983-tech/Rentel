import { prisma } from "./prisma.js";

export type ServiceHistoryRow = {
  id: string;
  inventoryId: string;
  details: string | null;
  techName: string | null;
  repairHours: number | null;
  createdAt: Date;
};

export async function appendServiceHistoryEntry(input: {
  inventoryId: string;
  details?: string | null;
  techName?: string | null;
  repairHours?: number | null;
  createdAt?: Date;
}): Promise<void> {
  const inventoryId = String(input.inventoryId || "").trim();
  if (!inventoryId) return;

  const details = input.details ? String(input.details).trim() : null;
  const techName = input.techName ? String(input.techName).trim() : null;
  const repairHours =
    typeof input.repairHours === "number" && Number.isFinite(input.repairHours)
      ? Number(input.repairHours)
      : null;
  const createdAt = input.createdAt ?? new Date();

  await prisma.serviceHistoryEntry.create({
    data: {
      inventoryId,
      details,
      techName,
      repairHours,
      createdAt,
    },
  });
}

export async function getServiceHistoryEntries(
  inventoryIdInput: string,
  limitInput = 100,
): Promise<ServiceHistoryRow[]> {
  const inventoryId = String(inventoryIdInput || "").trim();
  const limit = Math.max(1, Math.min(500, Math.floor(Number(limitInput) || 100)));
  if (!inventoryId) return [];

  return prisma.serviceHistoryEntry.findMany({
    where: { inventoryId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

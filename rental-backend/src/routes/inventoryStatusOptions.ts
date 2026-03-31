import { Router } from "express";
import { requireAdmin } from "../lib/adminAuth.js";
import { prisma } from "../lib/prisma.js";
import { normalizeStatus } from "../lib/statusFormat.js";

export const apiInventoryStatusOptionsRouter = Router();

apiInventoryStatusOptionsRouter.get("/", async (_req, res) => {
  const options = await prisma.inventoryStatusOption.findMany({
    orderBy: { value: "asc" },
  });
  res.json(
    options.map((option) => ({
      ...option,
      value: normalizeStatus(option.value),
    })),
  );
});

apiInventoryStatusOptionsRouter.post("/", requireAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const value = normalizeStatus(body.value);
  if (!value) {
    res.status(400).json({ error: "Status value is required." });
    return;
  }

  const existingOptions = await prisma.inventoryStatusOption.findMany({
    select: { value: true },
  });
  const duplicate = existingOptions.some(
    (option) => normalizeStatus(option.value) === value,
  );
  if (duplicate) {
    res.status(409).json({ error: "That status option already exists." });
    return;
  }

  try {
    const created = await prisma.inventoryStatusOption.create({
      data: { value },
    });
    res.status(201).json(created);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      res.status(409).json({ error: "That status option already exists." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create status option." });
  }
});

apiInventoryStatusOptionsRouter.delete("/:id", requireAdmin, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) {
    res.status(400).json({ error: "Invalid status option id." });
    return;
  }
  const existing = await prisma.inventoryStatusOption.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Status option not found." });
    return;
  }

  await prisma.inventoryStatusOption.delete({ where: { id } });
  res.status(204).send();
});

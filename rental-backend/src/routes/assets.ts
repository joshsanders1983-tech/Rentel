import { Router } from "express";
import { requireAdmin } from "../lib/adminAuth.js";
import { prisma } from "../lib/prisma.js";

export const apiAssetsRouter = Router();

apiAssetsRouter.get("/", async (_req, res) => {
  const assets = await prisma.asset.findMany({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(assets);
});

apiAssetsRouter.post("/", requireAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const typeCode =
    typeof body.typeCode === "string" ? body.typeCode.trim() : "";
  const type =
    typeof body.type === "string" ? body.type.trim() : typeCode;
  const asset =
    typeof body.asset === "string" ? body.asset.trim() : type;
  const description =
    typeof body.description === "string" ? body.description.trim() : null;
  if (!type) {
    res.status(400).json({
      error: "Invalid body: typeCode is required.",
    });
    return;
  }

  try {
    const created = await prisma.asset.create({
      data: {
        asset,
        type,
        // Prisma uses `string | null` for optional text fields when `exactOptionalPropertyTypes` is enabled.
        description,
      },
    });
    res.status(201).json(created);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      res.status(409).json({ error: "That Type Code already exists." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create asset." });
  }
});

apiAssetsRouter.patch("/:id", requireAdmin, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) {
    res.status(400).json({ error: "Invalid asset id." });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const descriptionValue =
    typeof body.description === "string" ? body.description.trim() : "";
  const description = descriptionValue || null;

  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Asset not found." });
    return;
  }

  try {
    const updated = await prisma.asset.update({
      where: { id },
      data: { description },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update asset description." });
  }
});

// "Remove from Add Inventory list" = deactivate asset type.
apiAssetsRouter.delete("/:id", requireAdmin, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) {
    res.status(400).json({ error: "Invalid asset id." });
    return;
  }
  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Asset not found." });
    return;
  }

  await prisma.asset.update({
    where: { id },
    data: { active: false },
  });
  res.status(204).send();
});


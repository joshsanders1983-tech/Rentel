export function normalizeStatus(value: unknown): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";

  return text
    .split(" ")
    .map((part) => {
      if (!part) return "";
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

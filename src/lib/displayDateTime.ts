function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDisplayDateInstant(value: Date): string {
  if (Number.isNaN(value.getTime())) return "-";
  return `${pad2(value.getMonth() + 1)}/${pad2(value.getDate())}/${value.getFullYear()}`;
}

export function formatDisplayTimeInstant(value: Date): string {
  if (Number.isNaN(value.getTime())) return "-";
  const hh = value.getHours();
  const mm = value.getMinutes();
  const ap = hh >= 12 ? "p" : "a";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${pad2(mm)}${ap}`;
}

export function formatDisplayDateTimeInstant(value: Date): string {
  const d = formatDisplayDateInstant(value);
  const t = formatDisplayTimeInstant(value);
  if (d === "-" || t === "-") return "-";
  return `${d} ${t}`;
}

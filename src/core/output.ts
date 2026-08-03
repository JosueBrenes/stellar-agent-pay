const noColor =
  process.env.NO_COLOR !== undefined ||
  process.env.STELLAR_AGENT_PAY_NO_COLOR !== undefined ||
  !process.stdout.isTTY;

const ESC = "";

function wrap(code: number, close: number) {
  return (text: string): string => (noColor ? text : `${ESC}[${code}m${text}${ESC}[${close}m`);
}

export const color = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

export const glyph = {
  pass: color.green("✓"),
  fail: color.red("✗"),
  skip: color.gray("·"),
  arrow: color.dim("→"),
};

export function heading(text: string): string {
  return color.bold(text);
}

export function keyValue(rows: Array<[string, string]>, indent = "  "): string {
  const width = Math.max(0, ...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `${indent}${color.dim(`${k}:`.padEnd(width + 1))} ${v}`).join("\n");
}

export function print(line = ""): void {
  process.stdout.write(`${line}\n`);
}

export function printErr(line = ""): void {
  process.stderr.write(`${line}\n`);
}

export function json(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, jsonReplacer, 2)}\n`);
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

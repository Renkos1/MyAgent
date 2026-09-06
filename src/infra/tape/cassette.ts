/**
 * 录音带的格式、文件名和脱敏 —— ADR 0012 的 ③④⑤⑥ 落地。
 *
 * @remarks
 * IMPORTANT: 这个文件是唯一碰 fs 的地方。往返的逻辑在 `http.ts`，那半边不碰 IO。
 *
 * SAFETY: 录音带是要进 Git 的文件。写进去的秘密等于已经泄露 ——
 * 删 commit 没用，必须去 provider 后台吊销。所以 header 用白名单
 * （见 {@link KEPT_HEADERS}），而且抹在写盘前，不是读盘时。
 *
 * @see docs/decisions/0012-replay-cassette-format.md
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** 一次 HTTP 往返。请求也存，理由见 ADR 0012 §④。 */
export type Exchange = {
  readonly request: {
    readonly method: string;
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string | null;
  };
  readonly response: {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  };
};

/**
 * 一盘带子 = 一个场景的全部往返。
 *
 * @remarks
 * name 是场景名（和契约套件的 ScenarioName 对齐），其余三样进文件名 ——
 * IMPORTANT: 日期在文件名里，不用打开文件就知道这盘多旧（ADR 0012 §⑥）。
 */
export type Cassette = {
  readonly name: string;
  readonly provider: string;
  /** yyyy-mm-dd。录音带会腐烂，这是它的保质期标签。 */
  readonly recordedAt: string;
  readonly apiVersion: string;
  readonly exchanges: readonly Exchange[];
};

/**
 * 允许写进文件的 header。
 *
 * SAFETY: IMPORTANT: 这是白名单，不是黑名单。黑名单挡不住明天新增的鉴权头 ——
 * provider 加一个新 header，黑名单不会自己长出来，而白名单默认就挡住了。
 */
export const KEPT_HEADERS: readonly string[] = [
  "content-type",
  "request-id",
  "retry-after",
  "anthropic-version",
];

/**
 * 按白名单筛 header，顺便统一成小写键。
 *
 * @param headers - 原始 header
 * @returns 只剩白名单里那几个
 */
export function keepHeaders(
  headers: Iterable<readonly [string, string]>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of headers) {
    const key = k.toLowerCase();
    if (KEPT_HEADERS.includes(key)) out[key] = v;
  }
  return out;
}

/**
 * 文件名。ADR 0012 §⑥：provider + 场景 + 日期 + API 版本。
 *
 * @param c - 带子的元信息
 * @returns 形如 `anthropic-completed-2026-09-06-2023-06-01.json`
 */
export function cassetteFileName(c: Omit<Cassette, "exchanges">): string {
  return `${c.provider}-${c.name}-${c.recordedAt}-${c.apiVersion}.json`;
}

/** 同一个 provider + 场景的全部文件（不管日期和版本）。 */
function matchingFiles(dir: string, provider: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  const prefix = `${provider}-${name}-`;
  return readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort();
}

/**
 * 写一盘带子。
 *
 * @param dir - 录音带目录
 * @param c - 要写的带子
 * @returns 写出去的文件名
 * @throws 同一个 provider + 场景已经有带子时（ADR 0012 §③）——
 *   IMPORTANT: 重录前必须先删掉旧的。静默覆盖会悄悄改掉别的测试的输入。
 */
export function saveCassette(dir: string, c: Cassette): string {
  const existing = matchingFiles(dir, c.provider, c.name);
  if (existing.length > 0) {
    throw new Error(
      `录音带重名：${c.provider}/${c.name} 已经有 ${existing.join("、")}。` +
        `重录前先删掉它 —— 覆盖会悄悄改掉别的测试的输入。`,
    );
  }
  mkdirSync(dir, { recursive: true });
  const file = cassetteFileName(c);
  writeFileSync(join(dir, file), `${JSON.stringify(c, null, 2)}\n`, "utf8");
  return file;
}

/**
 * 读一盘带子。
 *
 * @param dir - 录音带目录
 * @param provider - 供应商
 * @param name - 场景名
 * @returns 带子的内容
 * @throws 找不到（ADR 0012 §⑤：缺带子是测试红，不是自动补录）或找到多盘时
 */
export function loadCassette(
  dir: string,
  provider: string,
  name: string,
): Cassette {
  const found = matchingFiles(dir, provider, name);
  const [only] = found;
  if (only === undefined) {
    throw new Error(
      `没有录音带：${provider}/${name}。` +
        `IMPORTANT: 缺带子不自动补录 —— 跑一次录制脚本，别让 CI 去打真 API。`,
    );
  }
  if (found.length > 1) {
    throw new Error(
      `录音带重名：${provider}/${name} 有 ${found.join("、")} 多盘，分不出该用哪一盘。`,
    );
  }
  return JSON.parse(readFileSync(join(dir, only), "utf8")) as Cassette;
}

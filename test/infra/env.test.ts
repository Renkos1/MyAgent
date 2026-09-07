import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { readEnv, sourceOf } from "../../src/infra/env.ts";
import type { EnvSource } from "../../src/infra/env.ts";
import { isSecret } from "../../src/domain/secret.ts";

const TOKEN = "sk-live-DO-NOT-LEAK-4242";
const URL = "https://api.deepseek.com/anthropic";

/** 一份刚好合法的环境。各条测试在它上面改一处。 */
const full: EnvSource = {
  AGENT_AUTH_TOKEN: TOKEN,
  AGENT_BASE_URL: URL,
  AGENT_MODEL: "deepseek-v4-flash",
};

/** 挂掉时报了哪几个变量名。 */
const names = (s: EnvSource): readonly string[] => {
  const r = readEnv(s);
  if (r.ok) throw new Error("本该失败却成功了");
  return r.error.map((i) => i.name);
};

describe("readEnv：成功的那条路", () => {
  it("三个必填齐了就成功，MAX_TOKENS 走默认 1024", () => {
    const r = readEnv(full);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.baseURL).toBe(URL);
    expect(r.value.model).toBe("deepseek-v4-flash");
    expect(r.value.maxTokens).toBe(1024);
  });

  it("SAFETY: token 是 Secret，整份配置打印出来不含真值", () => {
    const r = readEnv(full);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isSecret(r.value.authToken)).toBe(true);
    expect(r.value.authToken.expose()).toBe(TOKEN);
    // 这两条是门禁：配置对象会被打进日志和错误上报
    expect(inspect(r.value, { depth: null, showHidden: true })).not.toContain(
      TOKEN,
    );
    expect(JSON.stringify(r.value)).not.toContain(TOKEN);
  });
});

describe("readEnv：一次报全，不是报第一个", () => {
  it("三个都缺时，三个都在", () => {
    expect(names({}).toSorted()).toEqual([
      "AGENT_AUTH_TOKEN",
      "AGENT_BASE_URL",
      "AGENT_MODEL",
    ]);
  });

  it("报的是带前缀的完整变量名，能直接抄进 .env", () => {
    const r = readEnv({});
    if (r.ok) throw new Error("本该失败");
    for (const i of r.error) expect(i.name.startsWith("AGENT_")).toBe(true);
  });

  /**
   * IMPORTANT: 四个字段共用同一套 missing/invalid 映射，所以四个都要测。
   * TRAP: 这一条原本只测了 BASE_URL —— 而「测一个就以为覆盖了同一套机制」
   * 正是它漏掉的东西：把 MODEL 那一格的 missing 和 invalid 对调，
   * 两条消息**仍然不同**，只测「不同」的断言照样绿。
   * 所以下面断言的是**内容**，不只是「不一样」。
   */
  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly badValue: string;
    readonly missingSays: string;
    readonly invalidSays: string;
  }> = [
    {
      name: "AGENT_BASE_URL",
      badValue: "api.deepseek.com",
      missingSays: "没设",
      invalidSays: "完整 URL",
    },
    {
      name: "AGENT_MODEL",
      badValue: "gpt-4o",
      missingSays: "没设",
      invalidSays: "不在认得的名单里",
    },
    {
      name: "AGENT_MAX_TOKENS",
      badValue: "abc",
      missingSays: "",
      invalidSays: "1 到 200000",
    },
  ];

  it.each(CASES)(
    "$name 的缺失和非法各说各的话，而且没说反",
    ({ name, badValue, missingSays, invalidSays }) => {
      const key = name.replace("AGENT_", "");
      const invalid = readEnv({ ...full, [name]: badValue });
      if (invalid.ok) throw new Error(`${name} 填 ${badValue} 本该失败`);
      const why = invalid.error.find((i) => i.name === name)?.why ?? "";
      expect(why).toContain(invalidSays);

      // MAX_TOKENS 有默认值，缺失不是错误 —— 只有它没有 missing 那一半
      if (missingSays === "") {
        expect(readEnv(full).ok).toBe(true);
        return;
      }
      const missing = readEnv({ ...full, [name]: "" });
      if (missing.ok) throw new Error(`${key} 缺失本该失败`);
      const m = missing.error.find((i) => i.name === name)?.why ?? "";
      expect(m).toContain(missingSays);
      // 关键：缺失的话里不许出现「非法」那一半的措辞，反之亦然
      expect(m).not.toContain(invalidSays);
      expect(why).not.toContain(missingSays);
    },
  );

  it("AUTH_TOKEN 缺失时说的是「没设」，不是别的", () => {
    const r = readEnv({});
    if (r.ok) throw new Error("本该失败");
    const why = r.error.find((i) => i.name === "AGENT_AUTH_TOKEN")?.why ?? "";
    expect(why).toContain("没设");
    expect(why).toContain("不要写进代码");
  });
});

describe("readEnv：空串按「没设」处理", () => {
  it("空串等价于缺失", () => {
    expect(names({ ...full, AGENT_MODEL: "" })).toEqual(["AGENT_MODEL"]);
  });

  it("AGENT_ 是空串时回落到 ANTHROPIC_，而不是直接判缺", () => {
    const r = readEnv({
      ...full,
      AGENT_AUTH_TOKEN: "",
      ANTHROPIC_AUTH_TOKEN: TOKEN,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.authToken.expose()).toBe(TOKEN);
  });
});

describe("readEnv：两个前缀的优先级（D7 的那个 TRAP）", () => {
  it("AGENT_ 赢 ANTHROPIC_", () => {
    const r = readEnv({
      ...full,
      AGENT_BASE_URL: URL,
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.baseURL).toBe(URL);
  });

  it("只有 ANTHROPIC_ 时也能跑起来", () => {
    const r = readEnv({
      ANTHROPIC_AUTH_TOKEN: TOKEN,
      ANTHROPIC_BASE_URL: URL,
      ANTHROPIC_MODEL: "deepseek-v4-flash",
    });
    expect(r.ok).toBe(true);
  });

  it("sourceOf 说得出值到底来自哪个名字", () => {
    expect(sourceOf(full, "BASE_URL")).toBe("AGENT_BASE_URL");
    expect(sourceOf({ ANTHROPIC_BASE_URL: URL }, "BASE_URL")).toBe(
      "ANTHROPIC_BASE_URL",
    );
    expect(sourceOf({ AGENT_BASE_URL: "" }, "BASE_URL")).toBeUndefined();
    expect(sourceOf({}, "BASE_URL")).toBeUndefined();
  });
});

describe("readEnv：模型名是闭集（D4）", () => {
  it("认得的名字过", () => {
    const r = readEnv({ ...full, AGENT_MODEL: "claude-haiku-4-5-20251001" });
    expect(r.ok).toBe(true);
  });

  it("没见过的名字挡下来，并且把认得的列出来", () => {
    const r = readEnv({ ...full, AGENT_MODEL: "gpt-4o" });
    if (r.ok) throw new Error("本该失败");
    const why = r.error[0]?.why ?? "";
    expect(why).toContain("deepseek-v4-flash");
    expect(why).toContain("claude-haiku-4-5-20251001");
  });

  it("IMPORTANT: 少一位也挡得住 —— 正则挡不住的正是这一条", () => {
    expect(names({ ...full, AGENT_MODEL: "claude-haiku-4-5-2025100" })).toEqual(
      ["AGENT_MODEL"],
    );
    expect(names({ ...full, AGENT_MODEL: "deepseek-v4-flash " })).toEqual([
      "AGENT_MODEL",
    ]);
  });

  it("没跑过的模型不在闭集里，哪怕它真的存在", () => {
    expect(names({ ...full, AGENT_MODEL: "deepseek-v4-pro" })).toEqual([
      "AGENT_MODEL",
    ]);
  });
});

describe("readEnv：BASE_URL", () => {
  it("要带协议", () => {
    expect(names({ ...full, AGENT_BASE_URL: "api.deepseek.com" })).toEqual([
      "AGENT_BASE_URL",
    ]);
  });
});

describe("readEnv：MAX_TOKENS 的边界", () => {
  const tokens = (v: string): number => {
    const r = readEnv({ ...full, AGENT_MAX_TOKENS: v });
    if (!r.ok) throw new Error(`本该成功：${r.error[0]?.why ?? ""}`);
    return r.value.maxTokens;
  };

  it("正常值原样过", () => {
    expect(tokens("512")).toBe(512);
    expect(tokens("1")).toBe(1);
    expect(tokens("200000")).toBe(200000);
  });

  it("0 / 负数 / 小数 / 非数字 / 超上限全挡", () => {
    for (const v of ["0", "-1", "1.5", "abc", "200001"]) {
      expect(names({ ...full, AGENT_MAX_TOKENS: v })).toEqual([
        "AGENT_MAX_TOKENS",
      ]);
    }
  });

  it("没设时是默认值，不是报错", () => {
    const r = readEnv(full);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.maxTokens).toBe(1024);
  });
});

/**
 * 录音带机制的测试。验收标准是 ADR 0012 的条款，逐条落成断言。
 *
 * IMPORTANT: 这一层现在没有真适配器，所以上游用一个假 fetch ——
 * 被测的是「录和放这件事本身对不对」，不是「Anthropic 的响应长什么样」。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Cassette } from "../../src/infra/tape/cassette.ts";
import {
  KEPT_HEADERS,
  cassetteFileName,
  loadCassette,
  saveCassette,
} from "../../src/infra/tape/cassette.ts";
import type { FetchLike } from "../../src/infra/tape/http.ts";
import { recording, replaying } from "../../src/infra/tape/http.ts";

const META = {
  name: "completed",
  provider: "anthropic",
  recordedAt: "2026-09-06",
  apiVersion: "2023-06-01",
};

const URL_ = "https://api.anthropic.com/v1/messages";
const ASK =
  '{"model":"claude","messages":[{"role":"user","content":"问一句"}]}';

/** 上游：不管收到什么，都回同一个响应。测的是包装层，不是它。 */
function upstream(
  body = '{"stop_reason":"end_turn"}',
  status = 200,
  headers: Record<string, string> = { "content-type": "application/json" },
): FetchLike {
  return () => Promise.resolve(new Response(body, { status, headers }));
}

function tape(exchanges: Cassette["exchanges"]): Cassette {
  return { ...META, exchanges };
}

function oneExchange(
  reqBody: string | null = ASK,
  resBody = '{"stop_reason":"end_turn"}',
  status = 200,
): Cassette["exchanges"] {
  return [
    {
      request: {
        method: "POST",
        url: URL_,
        headers: { "content-type": "application/json" },
        body: reqBody,
      },
      response: {
        status,
        headers: { "content-type": "application/json", "request-id": "req_1" },
        body: resBody,
      },
    },
  ];
}

// ══════════════════════════════════════════════════════════════
// @see docs/decisions/0012-replay-cassette-format.md §⑦ —— 顺序取，但每次核对指纹
describe("replaying：请求对得上才放，对不上当场红", () => {
  it("对得上 → 原样还原 status / body / header", async () => {
    const res = await replaying(tape(oneExchange()))(URL_, {
      method: "POST",
      body: ASK,
    });
    expect([
      res.status,
      await res.text(),
      res.headers.get("request-id"),
    ]).toEqual([200, '{"stop_reason":"end_turn"}', "req_1"]);
  });

  it("body 变了 → 抛，且错误里两边的指纹都在", async () => {
    const play = replaying(tape(oneExchange()));
    await expect(
      play(URL_, { method: "POST", body: '{"messages":"换了一句"}' }),
    ).rejects.toThrow(/换了一句[\s\S]*问一句|问一句[\s\S]*换了一句/);
  });

  it("错误里说得出「该重录了」和录制日期", async () => {
    const play = replaying(tape(oneExchange()));
    await expect(play(URL_, { method: "POST", body: "别的" })).rejects.toThrow(
      /2026-09-06[\s\S]*重录/,
    );
  });

  it("url 变了 → 抛", async () => {
    const play = replaying(tape(oneExchange()));
    await expect(
      play("https://api.deepseek.com/anthropic/v1/messages", {
        method: "POST",
        body: ASK,
      }),
    ).rejects.toThrow(/对不上/);
  });

  it("method 变了 → 抛", async () => {
    const play = replaying(tape(oneExchange()));
    await expect(play(URL_, { method: "GET", body: ASK })).rejects.toThrow(
      /对不上/,
    );
  });

  // IMPORTANT: 录制端把 method 存成大写（见下面「都录下来了」那条），回放端拿到的
  //            却是调用方原样的字符串 —— 归一化只发生在 fingerprint 里面。
  //            少了那一步，同一个请求会因为大小写不同被判成「对不上」，是假警报。
  // TRAP: 不能指望 fetch 替你归一化。实测 get→GET、post→POST，
  //       但 patch 原样透传 —— WHATWG 的归一化名单里没有 PATCH。
  it("method 只有大小写不同 → 照样对得上", async () => {
    const play = replaying(tape(oneExchange()));
    const res = await play(URL_, { method: "post", body: ASK });
    expect(res.status).toBe(200);
  });

  it("带子放完了还请求 → 抛，且说得出带子里有几次", async () => {
    const play = replaying(tape(oneExchange()));
    await play(URL_, { method: "POST", body: ASK });
    await expect(play(URL_, { method: "POST", body: ASK })).rejects.toThrow(
      /只有 1 次往返，第 2 次请求没得给/,
    );
  });

  it("多次往返按顺序放", async () => {
    const two = [
      ...oneExchange(ASK, "第一次"),
      ...oneExchange("再问", "第二次"),
    ];
    const play = replaying(tape(two));
    const a = await play(URL_, { method: "POST", body: ASK });
    const b = await play(URL_, { method: "POST", body: "再问" });
    expect([await a.text(), await b.text()]).toEqual(["第一次", "第二次"]);
  });
});

// ══════════════════════════════════════════════════════════════
// @see docs/decisions/0012-replay-cassette-format.md §④ —— 请求也存
describe("recording：录下往返，且不挡住调用方读响应", () => {
  it("请求的 method / url / body 都录下来了", async () => {
    const rec = recording(upstream(), META);
    await rec.fetch(URL_, {
      method: "post",
      body: ASK,
      headers: { "content-type": "application/json" },
    });
    expect(rec.cassette().exchanges[0]?.request).toEqual({
      method: "POST", // 统一成大写，指纹才配得上
      url: URL_,
      headers: { "content-type": "application/json" },
      body: ASK,
    });
  });

  it("响应的 status / body / 白名单 header 都录下来了", async () => {
    const rec = recording(
      upstream("嗯", 429, {
        "content-type": "text/plain",
        "retry-after": "3",
      }),
      META,
    );
    await rec.fetch(URL_, { method: "POST", body: ASK });
    expect(rec.cassette().exchanges[0]?.response).toEqual({
      status: 429,
      headers: { "content-type": "text/plain", "retry-after": "3" },
      body: "嗯",
    });
  });

  it("录完之后调用方照样读得到响应体（clone 生效）", async () => {
    const rec = recording(upstream("给调用方的"), META);
    const res = await rec.fetch(URL_, { method: "POST", body: ASK });
    expect(await res.text()).toBe("给调用方的");
  });

  it("元信息原样带进带子", () => {
    expect(recording(upstream(), META).cassette()).toEqual({
      ...META,
      exchanges: [],
    });
  });
});

// ══════════════════════════════════════════════════════════════
// SAFETY: ADR 0012「白名单不是黑名单」。这一组是那条规矩的门禁。
describe("脱敏：白名单，而且抹在写盘前", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tape-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const SECRET = "sk-ant-FAKE-KEY-0123456789";

  it("假 key 不进磁盘：写出去的文件里搜不到它", async () => {
    const rec = recording(upstream(), META);
    await rec.fetch(URL_, {
      method: "POST",
      body: ASK,
      headers: { authorization: `Bearer ${SECRET}`, "x-api-key": SECRET },
    });
    const file = saveCassette(dir, rec.cassette());
    expect(readFileSync(join(dir, file), "utf8")).not.toContain(SECRET);
  });

  it("白名单不是黑名单：没人见过的新鉴权头一样进不来", async () => {
    const rec = recording(upstream(), META);
    await rec.fetch(URL_, {
      method: "POST",
      body: ASK,
      headers: { "x-provider-invented-this-tomorrow": SECRET },
    });
    expect(rec.cassette().exchanges[0]?.request.headers).toEqual({});
  });

  it("白名单里的那几个照常留下", async () => {
    const rec = recording(upstream(), META);
    await rec.fetch(URL_, {
      method: "POST",
      body: ASK,
      headers: {
        "Content-Type": "application/json",
        "Anthropic-Version": "2023-06-01",
      },
    });
    expect(rec.cassette().exchanges[0]?.request.headers).toEqual({
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    });
  });

  it("白名单本身就这四个，改动要经过这条断言", () => {
    expect([...KEPT_HEADERS]).toEqual([
      "content-type",
      "request-id",
      "retry-after",
      "anthropic-version",
    ]);
  });
});

// ══════════════════════════════════════════════════════════════
// @see docs/decisions/0012-replay-cassette-format.md §③⑤⑥
describe("文件：名字带日期，重名拒绝，缺带子不自动补录", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tape-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("文件名 = provider-场景-日期-API 版本", () => {
    expect(cassetteFileName(META)).toBe(
      "anthropic-completed-2026-09-06-2023-06-01.json",
    );
  });

  it("重名拒绝：同一个 provider + 场景已有带子就不许再写", () => {
    saveCassette(dir, tape(oneExchange()));
    expect(() =>
      saveCassette(dir, { ...tape(oneExchange()), recordedAt: "2026-12-31" }),
    ).toThrow(/cassette\.duplicate-name[\s\S]*先删掉它/);
  });

  it("缺带子 → 抛，而且明说不自动补录", () => {
    expect(() => loadCassette(dir, "anthropic", "completed")).toThrow(
      // 后半段是这条测试的目的本身：消息必须明说不自动补录\n      /cassette\.not-found[\s\S]*不自动补录/,
    );
  });

  it("同一个场景躺着两盘 → 抛，不许猜用哪一盘", () => {
    saveCassette(dir, tape(oneExchange()));
    // 绕过 saveCassette 直接写，模拟「手工塞进去的第二盘」
    writeFileSync(
      join(dir, "anthropic-completed-2026-12-31-2023-06-01.json"),
      "{}",
      "utf8",
    );
    expect(() => loadCassette(dir, "anthropic", "completed")).toThrow(
      /cassette\.duplicate-name[\s\S]*多盘/,
    );
  });

  it("往返一圈：录 → 存 → 读 → 放，拿到的还是同一个响应", async () => {
    const rec = recording(upstream("一圈之后"), META);
    await rec.fetch(URL_, { method: "POST", body: ASK });
    saveCassette(dir, rec.cassette());

    const played = await replaying(loadCassette(dir, "anthropic", "completed"))(
      URL_,
      { method: "POST", body: ASK },
    );
    expect(await played.text()).toBe("一圈之后");
  });
});

// ══════════════════════════════════════════════════════════════
// 变异测试逼出来的一组：全是「参数的第三种形状」和「目录里还有别的文件」。
// IMPORTANT: 第一条和契约套件那次 opts={} 是同一个洞 ——
//            规律写进文档了，新代码里照样又犯一次。
describe("边角：不传 init、目录里有别的文件、body 不是字符串", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tape-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("录制：完全不传 init → 记成 GET、无 body、无 header", async () => {
    const rec = recording(upstream(), META);
    await rec.fetch(URL_);
    expect(rec.cassette().exchanges[0]?.request).toEqual({
      method: "GET",
      url: URL_,
      headers: {},
      body: null,
    });
  });

  it("回放：完全不传 init → 配得上录成 GET 的那一盘", async () => {
    const rec = recording(upstream("无参也能放"), META);
    await rec.fetch(URL_);
    const res = await replaying(rec.cassette())(URL_);
    expect(await res.text()).toBe("无参也能放");
  });

  it("body 不是字符串 → 当场抛，不静默变 null", async () => {
    const rec = recording(upstream(), META);
    await expect(
      rec.fetch(URL_, { method: "POST", body: new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow(/cassette\.unsupported-body/);
  });

  it("目录里别的场景的带子 → 找不到就是找不到，不许张冠李戴", () => {
    saveCassette(dir, { ...tape(oneExchange()), name: "refused" });
    expect(() => loadCassette(dir, "anthropic", "completed")).toThrow(
      /cassette\.not-found/,
    );
  });

  it("目录里同名但不是 .json 的文件 → 不当带子", () => {
    writeFileSync(
      join(dir, "anthropic-completed-2026-09-06-2023-06-01.md"),
      "这是笔记不是带子",
      "utf8",
    );
    expect(() => loadCassette(dir, "anthropic", "completed")).toThrow(
      /cassette\.not-found/,
    );
  });

  it("body 显式传 null（不是不传）→ 记成 null，且和空串区分得开", async () => {
    const rec = recording(upstream(), META);
    await rec.fetch(URL_, { method: "POST", body: null });
    expect(rec.cassette().exchanges[0]?.request.body).toBeNull();

    // TRAP: 指纹里 null 用占位符表示。占位符去掉的话，
    //       body:null 和 body:"" 会算出同一个指纹 —— 带子就配错了。
    await expect(
      replaying(rec.cassette())(URL_, { method: "POST", body: "" }),
    ).rejects.toThrow(/对不上/);
  });

  it("多盘时报错点名每一盘，而且顺序固定", () => {
    saveCassette(dir, tape(oneExchange()));
    writeFileSync(
      join(dir, "anthropic-completed-2026-12-31-2023-06-01.json"),
      "{}",
      "utf8",
    );
    expect(() => loadCassette(dir, "anthropic", "completed")).toThrow(
      "anthropic-completed-2026-09-06-2023-06-01.json、anthropic-completed-2026-12-31-2023-06-01.json",
    );
  });

  it("目录压根不存在 → 也是「没有录音带」，不是崩", () => {
    expect(() =>
      loadCassette(join(dir, "还没建"), "anthropic", "completed"),
    ).toThrow(/cassette\.not-found/);
  });

  it("重名的报错里点名旧文件（ADR 0012 §③ 的全部价值在这句话）", () => {
    saveCassette(dir, tape(oneExchange()));
    expect(() =>
      saveCassette(dir, { ...tape(oneExchange()), recordedAt: "2026-12-31" }),
    ).toThrow(/anthropic-completed-2026-09-06-2023-06-01\.json/);
  });

  it("写出去的是缩进过、以换行结尾的 JSON（重录要 diff 得动）", () => {
    const file = saveCassette(dir, tape(oneExchange()));
    const raw = readFileSync(join(dir, file), "utf8");
    expect([raw.endsWith("\n"), raw.includes('\n  "name"')]).toEqual([
      true,
      true,
    ]);
  });
});

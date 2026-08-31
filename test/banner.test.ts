import { describe, expect, it } from "vitest";

import { banner } from "../src/banner.ts";

describe("banner", () => {
  it("拼出启动横幅", () => {
    expect(banner("myagent")).toBe("myagent is alive");
  });
});

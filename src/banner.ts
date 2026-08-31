/**
 * 阶段 0 的占位模块 —— 阶段 1 建立领域层时删掉它和对应测试。
 *
 * 存在的唯一理由：让 verify 的五个环节（check / lint / format / test / build）
 * 都有东西可跑，从而证明整条工具链是通的。
 */
export function banner(name: string): string {
  return `${name} is alive`;
}

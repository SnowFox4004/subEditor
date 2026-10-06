/**
 * 测试环境初始化。
 * React 19 需要显式声明处于 act 环境，否则每次状态更新都会打印警告。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export {};

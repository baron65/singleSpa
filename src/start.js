import { reroute } from "./navigation/reroute.js";
import { formatErrorMessage } from "./applications/app-errors.js";
import { setUrlRerouteOnly } from "./navigation/navigation-events.js";
import { isInBrowser } from "./utils/runtime-environment.js";

// 全局状态
let started = false;

/**
 * 微前端框架启动
 * @param {*} opts 提供的一些配置。 urlRerouteOnly 配置是否只有在url变化的时候才重新路由
 * 
 */
export function start(opts) {
  started = true;
  if (opts && opts.urlRerouteOnly) {
    setUrlRerouteOnly(opts.urlRerouteOnly);
  }
  if (isInBrowser) {
    reroute();
  }
}

/**
 * 对外暴露微前端是否初始化
 * @returns boolean
 */
export function isStarted() {
  return started;
}

if (isInBrowser) {
  // single-spa已经被加载5s了，且start方法没有被调用。
  // start方法调用前，应用会被加载，但不会初始化、挂载或者卸载等
  setTimeout(() => {
    if (!started) {
      console.warn(
        formatErrorMessage(
          1,
          __DEV__ &&
          `singleSpa.start() has not been called, 5000ms after single-spa was loaded. Before start() is called, apps can be declared and loaded, but not bootstrapped or mounted.`
        )
      );
    }
  }, 5000);
}

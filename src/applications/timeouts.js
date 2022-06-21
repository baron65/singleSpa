import { assign } from "../utils/assign";
import { getProps } from "../lifecycles/prop.helpers";
import { objectType, toName } from "./app.helpers";
import { formatErrorMessage } from "./app-errors";

const defaultWarningMillis = 1000;

// millis 毫秒
// dieOnTimeout 超时是否将程序卸载
// warningMillis 发出警告的毫秒
// defaultWarningMillis 默认发出警告的毫秒 1000

const globalTimeoutConfig = {
  bootstrap: {
    millis: 4000,
    dieOnTimeout: false,
    warningMillis: defaultWarningMillis,
  },
  mount: {
    millis: 3000,
    dieOnTimeout: false,
    warningMillis: defaultWarningMillis,
  },
  unmount: {
    millis: 3000,
    dieOnTimeout: false,
    warningMillis: defaultWarningMillis,
  },
  unload: {
    millis: 3000,
    dieOnTimeout: false,
    warningMillis: defaultWarningMillis,
  },
  update: {
    millis: 3000,
    dieOnTimeout: false,
    warningMillis: defaultWarningMillis,
  },
};
// 设置初始化最长时间
export function setBootstrapMaxTime(time, dieOnTimeout, warningMillis) {
  if (typeof time !== "number" || time <= 0) {
    throw Error(
      formatErrorMessage(
        16,
        __DEV__ &&
        `bootstrap max time must be a positive integer number of milliseconds`
      )
    );
  }

  globalTimeoutConfig.bootstrap = {
    millis: time,
    dieOnTimeout,
    warningMillis: warningMillis || defaultWarningMillis,
  };
}

// 设置挂载最长时间
export function setMountMaxTime(time, dieOnTimeout, warningMillis) {
  if (typeof time !== "number" || time <= 0) {
    throw Error(
      formatErrorMessage(
        17,
        __DEV__ &&
        `mount max time must be a positive integer number of milliseconds`
      )
    );
  }

  globalTimeoutConfig.mount = {
    millis: time,
    dieOnTimeout,
    warningMillis: warningMillis || defaultWarningMillis,
  };
}

// 设置卸载最长时间
export function setUnmountMaxTime(time, dieOnTimeout, warningMillis) {
  if (typeof time !== "number" || time <= 0) {
    throw Error(
      formatErrorMessage(
        18,
        __DEV__ &&
        `unmount max time must be a positive integer number of milliseconds`
      )
    );
  }

  globalTimeoutConfig.unmount = {
    millis: time,
    dieOnTimeout,
    warningMillis: warningMillis || defaultWarningMillis,
  };
}

// 设置卸下最长时间
export function setUnloadMaxTime(time, dieOnTimeout, warningMillis) {
  if (typeof time !== "number" || time <= 0) {
    throw Error(
      formatErrorMessage(
        19,
        __DEV__ &&
        `unload max time must be a positive integer number of milliseconds`
      )
    );
  }

  globalTimeoutConfig.unload = {
    millis: time,
    dieOnTimeout,
    warningMillis: warningMillis || defaultWarningMillis,
  };
}

/**
 * 合适的时候
 * @param {*} appOrParcel app或者经过包裹的子应用
 * @param {*} lifecycle string 生命周期 'bootstrap' | 'mount'| 'unload'|'unmount'|'update'
 * @returns 
 */
export function reasonableTime(appOrParcel, lifecycle) {
  // 获取超时配置
  const timeoutConfig = appOrParcel.timeouts[lifecycle];

  // 发出警告的时间点
  const warningPeriod = timeoutConfig.warningMillis;

  // 判断是"parcel" 还是 "application"类型
  const type = objectType(appOrParcel);

  return new Promise((resolve, reject) => {
    // 是否执行完标识
    let finished = false;

    // 是否已抛过错误标识
    let errored = false;

    //将当前props传入 并 执行app的生命周期列表
    appOrParcel[lifecycle](getProps(appOrParcel))
      .then((val) => {
        finished = true;
        resolve(val);
      })
      .catch((val) => {
        finished = true;
        reject(val);
      });

    // 定义一个发出警告的定时器
    setTimeout(() => maybeTimingOut(1), warningPeriod);

    setTimeout(() => maybeTimingOut(true), timeoutConfig.millis);

    // 超时抛错信息
    const errMsg = formatErrorMessage(
      31,
      __DEV__ &&
      `Lifecycle function ${lifecycle} for ${type} ${toName(
        appOrParcel
      )} lifecycle did not resolve or reject for ${timeoutConfig.millis} ms.`,
      lifecycle,
      type,
      toName(appOrParcel),
      timeoutConfig.millis
    );

    // 可能超时
    function maybeTimingOut(shouldError) {
      // 当执行此函数时，生命周期列表函数还没有执行完 finished 为false
      if (!finished) {
        if (shouldError === true) {
          errored = true;
          if (timeoutConfig.dieOnTimeout) {
            //把app挂掉。即 reject掉 
            reject(Error(errMsg));
          } else {
            console.error(errMsg);
            //don't resolve or reject, we're waiting this one out
          }
        } else if (!errored) { // 没有抛过错。
          const numWarnings = shouldError;
          const numMillis = numWarnings * warningPeriod;
          console.warn(errMsg);
          if (numMillis + warningPeriod < timeoutConfig.millis) {
            // 递归抛错次数
            setTimeout(() => maybeTimingOut(numWarnings + 1), warningPeriod);
          }
        }
      }
    }
  });
}

/**
 * 确保子应用 有超时设置：合并子应用入口文件导出的超时配置 timeouts
 * @param {*} timeouts 子应用入口文件导出的超时配置timeouts
 * @returns 该应用的各个生命周期超时配置
 */
export function ensureValidAppTimeouts(timeouts) {

  const result = {};

  for (let key in globalTimeoutConfig) {
    result[key] = assign(
      {},
      globalTimeoutConfig[key],
      (timeouts && timeouts[key]) || {}
    );
  }

  return result;
}

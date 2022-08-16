import {
  NOT_BOOTSTRAPPED,
  BOOTSTRAPPING,
  NOT_MOUNTED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { reasonableTime } from "../applications/timeouts.js";
import { handleAppError, transformErr } from "../applications/app-errors.js";

/**
 * 执行 appOrParcel.bootstrap逻辑
 * 迭代 appOrParcel状态
 * 
 * @param {*} appOrParcel 
 * @param {*} hardFail 
 * @returns 
 */
export function toBootstrapPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    // 不是未启动状态，则直接返回appOrParcel
    if (appOrParcel.status !== NOT_BOOTSTRAPPED) {
      return appOrParcel;
    }

    // app状态设置为启动中
    appOrParcel.status = BOOTSTRAPPING;

    if (!appOrParcel.bootstrap) {
      //如果没有bootstrap方法，则返回bootstrap的默认实现
      // Default implementation of bootstrap
      return Promise.resolve().then(successfulBootstrap);
    }

    // reasonableTime(appOrParcel, "bootstrap") 合理的时间内执行appOrParcel.bootstrap逻辑，并将执行结果返回来
    return reasonableTime(appOrParcel, "bootstrap")
      .then(successfulBootstrap)
      .catch((err) => {
        // 需要处理错误：直接抛出错误
        if (hardFail) {
          throw transformErr(err, appOrParcel, SKIP_BECAUSE_BROKEN);
        } else {
          // 否则：执行完异常处理器池中所有逻辑后 返回 app
          handleAppError(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          return appOrParcel;
        }
      });
  });

  function successfulBootstrap() {
    // 设置状态为未挂载
    appOrParcel.status = NOT_MOUNTED;
    return appOrParcel;
  }
}

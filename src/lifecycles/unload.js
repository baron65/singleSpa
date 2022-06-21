import {
  NOT_MOUNTED,
  UNLOADING,
  NOT_LOADED,
  LOAD_ERROR,
  SKIP_BECAUSE_BROKEN,
  toName,
} from "../applications/app.helpers.js";
import { handleAppError } from "../applications/app-errors.js";
import { reasonableTime } from "../applications/timeouts.js";

const appsToUnload = {};

export function toUnloadPromise(app) {
  return Promise.resolve().then(() => {
    const unloadInfo = appsToUnload[toName(app)];

    if (!unloadInfo) {
      /* No one has called unloadApplication for this app,
       */
      return app;
    }

    if (app.status === NOT_LOADED) {
      /* This app is already unloaded. We just need to clean up
       * anything that still thinks we need to unload the app.
       */
      // 此应用程序已卸载。我们只需要清理仍然认为我们需要卸载应用程序的任何内容。

      finishUnloadingApp(app, unloadInfo);
      return app;
    }

    if (app.status === UNLOADING) {
      /* Both unloadApplication and reroute want to unload this app.
       * It only needs to be done once, though.
       */
      // unloadApplication 和 reroute 都想卸载这个应用程序。不过，它只需要执行一次。

      return unloadInfo.promise.then(() => app);
    }

    if (app.status !== NOT_MOUNTED && app.status !== LOAD_ERROR) {
      /* 只有app在解除挂载或加载错误的情况下才能卸载
       */
      return app;
    }

    // 执行卸载核心逻辑
    const unloadPromise =
      app.status === LOAD_ERROR
        ? Promise.resolve()
        : reasonableTime(app, "unload");

    app.status = UNLOADING;

    return unloadPromise
      .then(() => {
        finishUnloadingApp(app, unloadInfo);
        return app;
      })
      .catch((err) => {
        errorUnloadingApp(app, unloadInfo, err);
        return app;
      });
  });
}

/**
 * 卸载完成处理的东西
 *    1. 删除app的所有生命周期函数及卸载信息
 *    2. 将app的状态改为 未加载
 * @param {*} app 
 * @param {*} unloadInfo 
 */
function finishUnloadingApp(app, unloadInfo) {
  delete appsToUnload[toName(app)];

  // Unloaded apps don't have lifecycles
  delete app.bootstrap;
  delete app.mount;
  delete app.unmount;
  delete app.unload;

  app.status = NOT_LOADED;

  /* resolve the promise of whoever called unloadApplication.
   * This should be done after all other cleanup/bookkeeping
   */
  // 执行resolve，解决 unloadApplication调用者的promise
  unloadInfo.resolve();
}

function errorUnloadingApp(app, unloadInfo, err) {
  delete appsToUnload[toName(app)];

  // Unloaded apps don't have lifecycles
  delete app.bootstrap;
  delete app.mount;
  delete app.unmount;
  delete app.unload;

  handleAppError(err, app, SKIP_BECAUSE_BROKEN);
  unloadInfo.reject(err);
}

/**
 * 添加到要卸载的应用程序s中
 * @param {*} app 
 * @param {*} promiseGetter 外部创建的promise对象
 * @param {*} resolve 回调的resolve函数
 * @param {*} reject  回调的reject函数
 */
export function addAppToUnload(app, promiseGetter, resolve, reject) {
  appsToUnload[toName(app)] = { app, resolve, reject };
  // 给appUnloadInfo 设置 promise属性
  Object.defineProperty(appsToUnload[toName(app)], "promise", {
    get: promiseGetter,
  });
}

/**
 * 获取要卸载app的数据
 * @param {*} appName 
 * @returns 
 */
export function getAppUnloadInfo(appName) {
  return appsToUnload[appName];
}

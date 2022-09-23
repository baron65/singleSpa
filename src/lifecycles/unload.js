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

// 存储要移除的app信息
const appsToUnload = {};

export function toUnloadPromise(app) {
  return Promise.resolve().then(() => {
    // 拿到要移除的app的信息
    const unloadInfo = appsToUnload[toName(app)];

    // 欲移除集合中不存在app对应的信息。即没有调用过移除方法 unloadApplication【移除后会将app加入到appsToUnload】
    if (!unloadInfo) {
      /* No one has called unloadApplication for this app,
       */
      return app;
    }
    //如果app的状态是未加载
    if (app.status === NOT_LOADED) {
      /* This app is already unloaded. We just need to clean up
       * anything that still thinks we need to unload the app.
       */

      // 此应用已移除，但我们需要清理我们认为需要清理该应用程序的任何内容。
      finishUnloadingApp(app, unloadInfo);
      return app;
    }

    //如果app的状态是 移除中
    if (app.status === UNLOADING) {
      /* Both unloadApplication and reroute want to unload this app.
       * It only needs to be done once, though.
       */
      // unloadApplication 和 reroute 都想移除这个应用程序。不过，它只需要执行一次。

      return unloadInfo.promise.then(() => app);
    }

    // 如果app的状态不是 未挂载 | 加载错误 的情况直接返回app
    if (app.status !== NOT_MOUNTED && app.status !== LOAD_ERROR) {
      return app;
    }

    // 执行移除核心逻辑【执行子系统导出的unload方法逻辑】
    const unloadPromise =
      app.status === LOAD_ERROR
        ? Promise.resolve()
        : reasonableTime(app, "unload");

    // 状态更新为移除中
    app.status = UNLOADING;

    return unloadPromise
      .then(() => {
        //成功移除
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
 * 完成移除需要执行的逻辑
 *    1. 删除app的所有生命周期函数及移除信息
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
  // 已移除的应用程序没有生命周期
  delete app.bootstrap;
  delete app.mount;
  delete app.unmount;
  delete app.unload;

  handleAppError(err, app, SKIP_BECAUSE_BROKEN);
  unloadInfo.reject(err);
}

/**
 * 添加到要移除的应用程序中
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
 * 获取要移除app的数据
 * @param {*} appName 
 * @returns 
 */
export function getAppUnloadInfo(appName) {
  return appsToUnload[appName];
}

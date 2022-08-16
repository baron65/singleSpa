import {
  LOAD_ERROR,
  NOT_BOOTSTRAPPED,
  LOADING_SOURCE_CODE,
  SKIP_BECAUSE_BROKEN,
  NOT_LOADED,
  objectType,
  toName,
} from "../applications/app.helpers.js";
import { ensureValidAppTimeouts } from "../applications/timeouts.js";
import {
  handleAppError,
  formatErrorMessage,
} from "../applications/app-errors.js";
import {
  flattenFnArray,
  smellsLikeAPromise,
  validLifecycleFn,
} from "./lifecycle.helpers.js";
import { getProps } from "./prop.helpers.js";
import { assign } from "../utils/assign.js";

/**
 * 加载子应用app
 *  1. app.loadApp 加载逻辑函数，开放给使用者。要求得到一个promise
 * 
 * @param {*} app 
 * @returns 
 */
export function toLoadPromise(app) {
  return Promise.resolve().then(() => {

    // app 的属性 loadPromise 存在表示app正处于加载中
    if (app.loadPromise) {
      return app.loadPromise;
    }

    // app状态必须是未加载/加载错误，才能执行加载逻辑，否则直接返回app
    if (app.status !== NOT_LOADED && app.status !== LOAD_ERROR) {
      return app;
    }

    //更新app状态为 加载源码中
    app.status = LOADING_SOURCE_CODE;

    let appOpts, isUserErr;

    return (app.loadPromise = Promise.resolve()
      .then(() => {
        // loadPromise 加载函数执行结果，必须是promise
        const loadPromise = app.loadApp(getProps(app));
        if (!smellsLikeAPromise(loadPromise)) {
          // The name of the app will be prepended to this error message inside of the handleAppError function
          isUserErr = true;
          throw Error(
            formatErrorMessage(
              33,
              __DEV__ &&
              `single-spa loading function did not return a promise. Check the second argument to registerApplication('${toName(
                app
              )}', loadingFunction, activityFunction)`,
              toName(app)
            )
          );
        }
        return loadPromise.then((val) => {
          app.loadErrorTime = null;
          // val 为加载的子应用ES Modules. 属于js方式加载 
          appOpts = val;

          let validationErrMessage, validationErrCode;

          // appOpts必须是 object
          if (typeof appOpts !== "object") {
            validationErrCode = 34;
            if (__DEV__) {
              validationErrMessage = `does not export anything`;
            }
          }

          // 校验appOpts中的生命周期 bootstrap | mount | unmount 必须是函数或者函数数组

          if (
            // ES Modules don't have the Object prototype
            Object.prototype.hasOwnProperty.call(appOpts, "bootstrap") &&
            !validLifecycleFn(appOpts.bootstrap)
          ) {
            validationErrCode = 35;
            if (__DEV__) {
              validationErrMessage = `does not export a valid bootstrap function or array of functions`;
            }
          }

          if (!validLifecycleFn(appOpts.mount)) {
            validationErrCode = 36;
            if (__DEV__) {
              validationErrMessage = `does not export a mount function or array of functions`;
            }
          }

          if (!validLifecycleFn(appOpts.unmount)) {
            validationErrCode = 37;
            if (__DEV__) {
              validationErrMessage = `does not export a unmount function or array of functions`;
            }
          }


          // 判断appOpts是parcel还是application
          const type = objectType(appOpts);

          // 校验不通过。抛错并返回app
          if (validationErrCode) {
            let appOptsStr;
            try {
              appOptsStr = JSON.stringify(appOpts);
            } catch { }
            console.error(
              formatErrorMessage(
                validationErrCode,
                __DEV__ &&
                `The loading function for single-spa ${type} '${toName(
                  app
                )}' resolved with the following, which does not have bootstrap, mount, and unmount functions`,
                type,
                toName(app),
                appOptsStr
              ),
              appOpts
            );
            handleAppError(validationErrMessage, app, SKIP_BECAUSE_BROKEN);
            return app;
          }

          // 主要给开发者工具使用
          if (appOpts.devtools && appOpts.devtools.overlays) {
            app.devtools.overlays = assign(
              {},
              app.devtools.overlays,
              appOpts.devtools.overlays
            );
          }

          // 更新app状态为未启动
          app.status = NOT_BOOTSTRAPPED;
          //摊平生命周期函数为数组
          app.bootstrap = flattenFnArray(appOpts, "bootstrap");
          app.mount = flattenFnArray(appOpts, "mount");
          app.unmount = flattenFnArray(appOpts, "unmount");
          app.unload = flattenFnArray(appOpts, "unload");

          //设置app的超时
          app.timeouts = ensureValidAppTimeouts(appOpts.timeouts);

          // 删除app的属性loadPromise，表示加载结束
          delete app.loadPromise;

          return app;
        });
      })
      .catch((err) => {
        // 删除app的属性loadPromise，表示加载结束
        delete app.loadPromise;

        let newStatus;
        if (isUserErr) {
          //用户未按要求导出promse。即：loadApp执行结果不是promise
          newStatus = SKIP_BECAUSE_BROKEN;
        } else {
          //加载错误。更新app的属性loadErrorTime
          newStatus = LOAD_ERROR;
          app.loadErrorTime = new Date().getTime();
        }
        //处理异常池
        handleAppError(err, app, newStatus);

        return app;
      }));
  });
}

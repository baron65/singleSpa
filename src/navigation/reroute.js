import CustomEvent from "custom-event";
import { isStarted } from "../start.js";
import { toLoadPromise } from "../lifecycles/load.js";
import { toBootstrapPromise } from "../lifecycles/bootstrap.js";
import { toMountPromise } from "../lifecycles/mount.js";
import { toUnmountPromise } from "../lifecycles/unmount.js";
import {
  getAppStatus,
  getAppChanges,
  getMountedApps,
} from "../applications/apps.js";
import {
  callCapturedEventListeners,
  navigateToUrl,
} from "./navigation-events.js";
import { toUnloadPromise } from "../lifecycles/unload.js";
import {
  toName,
  shouldBeActive,
  NOT_MOUNTED,
  MOUNTED,
  NOT_LOADED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { assign } from "../utils/assign.js";
import { isInBrowser } from "../utils/runtime-environment.js";

/**
 * appChangeUnderway 记录single-spa是否正处于app切换中
 * peopleWaitingOnAppChange 等待更改的应用程序 队列
 * currentUrl 当前的url
 */
let appChangeUnderway = false,
  peopleWaitingOnAppChange = [],
  currentUrl = isInBrowser && window.location.href;

/**
 * 触发app的更改
 * @returns 
 */
export function triggerAppChange() {
  // Call reroute with no arguments, intentionally
  // 故意调用无参reroute
  return reroute();
}

/**
 * 重新路由。 sinle-spa的核心
 * @param {*} pendingPromises 待处理的 promise
 * @param {*} eventArguments 事件参数【路由事件监听回调函数的参数】。
 *  window.addEventListener("hashchange", function() { reroute([], arguments);});
 * @returns 
 */
export function reroute(pendingPromises = [], eventArguments) {
  //  app处于正在更改。此时如有又调用了本函数时，将该待处理事件追加到 等待更改的应用程序 队列中
  if (appChangeUnderway) {
    return new Promise((resolve, reject) => {
      peopleWaitingOnAppChange.push({
        resolve,
        reject,
        eventArguments,
      });
    });
  }

  const {
    appsToUnload,
    appsToUnmount,
    appsToLoad,
    appsToMount,
  } = getAppChanges();
  let appsThatChanged, //记录变动的app
    navigationIsCanceled = false, //导航已取消
    oldUrl = currentUrl,
    newUrl = (currentUrl = window.location.href);

  if (isStarted()) {
    // single-spa已启动
    // 执行更改
    appChangeUnderway = true;
    appsThatChanged = appsToUnload.concat(
      appsToLoad,
      appsToUnmount,
      appsToMount
    );
    return performAppChanges();
  } else {
    // single-spa未启动：加载的需要加载是的子应用
    appsThatChanged = appsToLoad;
    return loadApps();
  }

  function cancelNavigation() {
    navigationIsCanceled = true;
  }

  /**
   * 加载所有需要加载的应用
   * @returns 
   */
  function loadApps() {
    return Promise.resolve().then(() => {
      const loadPromises = appsToLoad.map(toLoadPromise);
      /**
       * 无论加载这些app成功还是失败，都要执行完所有的待执行的事件监听器
       */
      return (
        Promise.all(loadPromises)
          .then(callAllEventListeners)
          // there are no mounted apps, before start() is called, so we always return []
          // 在调用start()【single-spa没有启动】之前，没有挂载应用，所以总是返回[]
          .then(() => [])
          .catch((err) => {
            callAllEventListeners();
            throw err;
          })
      );
    });
  }

  /**
   * 执行应用的更改。【当single-spa启动后，调用reroute时】
   * 各阶段暴露生命周期钩子【采用分发自定义事件】：
   *  
   * @returns 
   */
  function performAppChanges() {
    return Promise.resolve().then(() => {
      // https://github.com/single-spa/single-spa/issues/545
      window.dispatchEvent(
        new CustomEvent(
          appsThatChanged.length === 0
            ? "single-spa:before-no-app-change"
            : "single-spa:before-app-change",
          getCustomEventDetail(true)
        )
      );

      // cancelNavigation 可以让用户在before-routing-event触发的时候，是否取消导航
      window.dispatchEvent(
        new CustomEvent(
          "single-spa:before-routing-event",
          getCustomEventDetail(true, { cancelNavigation })
        )
      );

      /**
       * navigationIsCanceled: true .用户执行了取消导航
       * 1.派发 before-mount-routing-event 事件
       * 2.完成更新并返回
       * 3.回到原地址url
       */
      if (navigationIsCanceled) {
        window.dispatchEvent(
          new CustomEvent(
            "single-spa:before-mount-routing-event",
            getCustomEventDetail(true)
          )
        );
        finishUpAndReturn();
        navigateToUrl(oldUrl);
        return;
      }

      // 卸载掉该卸载的apps
      const unloadPromises = appsToUnload.map(toUnloadPromise);

      // 解除该解除挂载的apps,并卸载掉
      const unmountUnloadPromises = appsToUnmount
        .map(toUnmountPromise)
        .map((unmountPromise) => unmountPromise.then(toUnloadPromise));

      const allUnmountPromises = unmountUnloadPromises.concat(unloadPromises);

      const unmountAllPromise = Promise.all(allUnmountPromises);

      unmountAllPromise.then(() => {
        // 所有该卸载的app卸载结束。
        // 执行该挂载的app前的生命周期事件。
        window.dispatchEvent(
          new CustomEvent(
            "single-spa:before-mount-routing-event",
            getCustomEventDetail(true)
          )
        );
      });

      /* We load and bootstrap apps while other apps are unmounting, but we
       * wait to mount the app until all apps are finishing unmounting
       */
      /**
       * 在加载或者初始化应用程序时有别的应用在解除挂载，我们会等到他们卸载完成后再继续。
       */

      const loadThenMountPromises = appsToLoad.map((app) => {
        return toLoadPromise(app).then((app) =>
          tryToBootstrapAndMount(app, unmountAllPromise)
        );
      });

      /* These are the apps that are already bootstrapped and just need
       * to be mounted. They each wait for all unmounting apps to finish up
       * before they mount.
       */
      /**
       * 这些是已经初始化完成了仅仅需要挂载的应用。他们都会等到那些正在卸载的应用完成卸载后再继续。
       */
      const mountPromises = appsToMount
        .filter((appToMount) => appsToLoad.indexOf(appToMount) < 0) //把没加载的app过滤出来
        .map((appToMount) => {
          return tryToBootstrapAndMount(appToMount, unmountAllPromise);
        });


      return unmountAllPromise
        .catch((err) => {
          callAllEventListeners();
          throw err;
        })
        .then(() => {
          /* Now that the apps that needed to be unmounted are unmounted, their DOM navigation
           * events (like hashchange or popstate) should have been cleaned up. So it's safe
           * to let the remaining captured event listeners to handle about the DOM event.
           */
          /**
           * 现在需要卸载的应用程序已卸载，
           * 它们的 DOM 导航事件（如 hashchange 或 popstate）应该已被清理。
           * 因此，让剩余的捕获事件侦听器处理 DOM 事件是安全的。
           */
          callAllEventListeners();

          // 挂载所有该挂载的app
          return Promise.all(loadThenMountPromises.concat(mountPromises))
            .catch((err) => {
              pendingPromises.forEach((promise) => promise.reject(err));
              throw err;
            })
            .then(finishUpAndReturn);
        });
    });
  }


  /**
   * 完成更新并返回
   * 1.获取已挂载的应用名数组returnValue
   * 2.将returnValue给到等待执行队列的执行结果
   * 3.派发app-change/no-app-change、routing-event 事件
   * 4.重置appChangeUnderway为false. 标识更新完成
   * 5.判断待更新队列是否新产生了数据，有则调用reroute, 直到为空
   * 6.返回returnValue
   * @returns returnValue
   */
  function finishUpAndReturn() {
    const returnValue = getMountedApps();
    pendingPromises.forEach((promise) => promise.resolve(returnValue));

    try {
      const appChangeEventName =
        appsThatChanged.length === 0
          ? "single-spa:no-app-change"
          : "single-spa:app-change";
      window.dispatchEvent(
        new CustomEvent(appChangeEventName, getCustomEventDetail())
      );
      window.dispatchEvent(
        new CustomEvent("single-spa:routing-event", getCustomEventDetail())
      );
    } catch (err) {
      /* We use a setTimeout because if someone else's event handler throws an error, single-spa
       * needs to carry on. If a listener to the event throws an error, it's their own fault, not
       * single-spa's.
       */
      setTimeout(() => {
        throw err;
      });
    }

    /* Setting this allows for subsequent calls to reroute() to actually perform
     * a reroute instead of just getting queued behind the current reroute call.
     * We want to do this after the mounting/unmounting is done but before we
     * resolve the promise for the `reroute` function.
     */
    /**
     * 设置appChangeUnderway,允许对 reroute() 的后续调用 实际执行重新路由，而不是仅仅在当前的重新路由调用之后排队。
     * 我们希望在mounting/unmounting完成之后但在我们解决 `reroute` 函数的承诺之前执行此操作。
     */
    appChangeUnderway = false;

    if (peopleWaitingOnAppChange.length > 0) {
      /* While we were rerouting, someone else triggered another reroute that got queued.
       * So we need reroute again.
       */
      // 当我们调用reroute时，其他人也调用了reroute，触发了另一个排队的重新路由。所以我们需要重新路由。
      const nextPendingPromises = peopleWaitingOnAppChange;
      peopleWaitingOnAppChange = [];
      reroute(nextPendingPromises);
    }

    return returnValue;
  }

  /* We need to call all event listeners that have been delayed because they were
   * waiting on single-spa. This includes haschange and popstate events for both
   * the current run of performAppChanges(), but also all of the queued event listeners.
   * We want to call the listeners in the same order as if they had not been delayed by
   * single-spa, which means queued ones first and then the most recent one.
   */
  /**
   * 我们需要调用所有因等待single-spa被延迟的事件监听器。
   * 包括当前运行performAppChanges()产生的hashchange和popstate事件，以及所有排队的事件监听器。
   * 我们希望以相同的顺序调用这些监听器就如同它们没有被single-spa延迟一样。
   * 这意味着先执行队列中的监听器，然后才是最近的监听器
   */
  function callAllEventListeners() {
    // 1.先执行队列中因single-spa延迟的事件。
    pendingPromises.forEach((pendingPromise) => {
      callCapturedEventListeners(pendingPromise.eventArguments);
    });
    // 2.再执行本身事件
    callCapturedEventListeners(eventArguments);
  }


  /**
   * 组装自定义事件的deTail数据，抛给监听事件的函数
   * @param {boolean} isBeforeChanges 在更改之前【带before的生命周期钩子事件传入 true】
   * @param {object} extraProperties  额外的属性对象
   * @returns 
   */
  function getCustomEventDetail(isBeforeChanges = false, extraProperties) {
    const newAppStatuses = {};
    const appsByNewStatus = {
      // for apps that were mounted
      [MOUNTED]: [],
      // for apps that were unmounted
      [NOT_MOUNTED]: [],
      // apps that were forcibly unloaded
      [NOT_LOADED]: [],
      // apps that attempted to do something but are broken now
      [SKIP_BECAUSE_BROKEN]: [],
    };

    if (isBeforeChanges) {
      appsToLoad.concat(appsToMount).forEach((app, index) => {
        addApp(app, MOUNTED);
      });
      appsToUnload.forEach((app) => {
        addApp(app, NOT_LOADED);
      });
      appsToUnmount.forEach((app) => {
        addApp(app, NOT_MOUNTED);
      });
    } else {
      appsThatChanged.forEach((app) => {
        addApp(app);
      });
    }

    const result = {
      detail: {
        newAppStatuses,
        appsByNewStatus,
        totalAppChanges: appsThatChanged.length,
        originalEvent: eventArguments?.[0],
        oldUrl,
        newUrl,
        navigationIsCanceled,
      },
    };

    if (extraProperties) {
      assign(result.detail, extraProperties);
    }

    return result;

    function addApp(app, status) {
      const appName = toName(app);
      status = status || getAppStatus(appName);
      newAppStatuses[appName] = status;
      const statusArr = (appsByNewStatus[status] =
        appsByNewStatus[status] || []);
      statusArr.push(appName);
    }
  }
}

/**
 * Let's imagine that some kind of delay occurred during application loading.
 * The user without waiting for the application to load switched to another route,
 * this means that we shouldn't bootstrap and mount that application, thus we check
 * twice if that application should be active before bootstrapping and mounting.
 * https://github.com/single-spa/single-spa/issues/524
 */
/**
 * 尝试初始化并挂载应用
 *  app是否该被激活
 *    是：初始化完成——>
 *        卸载该卸载的——>
 *        再次判断是否应该激活，是则挂载
 *    否：卸载该卸载的
 * @param {*} app 
 * @param {*} unmountAllPromise 需要被卸载的app
 * @returns 
 */
function tryToBootstrapAndMount(app, unmountAllPromise) {
  if (shouldBeActive(app)) {
    return toBootstrapPromise(app).then((app) =>
      unmountAllPromise.then(() =>
        //等所有该卸载的app卸载完成后。
        //再次看初始化好的app是否应该被激活，是则挂载
        shouldBeActive(app) ? toMountPromise(app) : app
      )
    );
  } else {
    return unmountAllPromise.then(() => app);
  }
}

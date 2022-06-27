import { reroute } from "./reroute.js";
import { find } from "../utils/find.js";
import { formatErrorMessage } from "../applications/app-errors.js";
import { isInBrowser } from "../utils/runtime-environment.js";
import { isStarted } from "../start.js";

/* We capture navigation event listeners so that we can make sure
 * that application navigation listeners are not called until
 * single-spa has ensured that the correct applications are
 * unmounted and mounted.
 */
// 我们捕获导航事件侦听器，以便我们可以确保在 single-spa 卸载和安装正确的应用程序之前不会调用应用程序导航侦听器。

// 存储事件监听器
const capturedEventListeners = {
  hashchange: [],
  popstate: [],
};

// 监听hashchange、popstate 路由事件
export const routingEventsListeningTo = ["hashchange", "popstate"];

/**
 * 导航到 url
 *    obj参数必须是如下情况：【navigateToUrl 必须使用字符串 url、使用 <a> 标记作为其上下文或使用 currentTarget 是 <a> 标记的事件调用】
 *      1. 字符串
 *      2. a标签dom对象。 ducument.querySelector('a')
 *      3. currentTarget是a标签的事件
 * @param {*} obj 
 * @returns 
 */
export function navigateToUrl(obj) {
  let url;
  if (typeof obj === "string") {
    url = obj;
  } else if (this && this.href) {
    url = this.href;
  } else if (
    obj &&
    obj.currentTarget &&
    obj.currentTarget.href &&
    obj.preventDefault
  ) {
    url = obj.currentTarget.href;
    obj.preventDefault();
  } else {
    throw Error(
      formatErrorMessage(
        14,
        __DEV__ &&
        `singleSpaNavigate/navigateToUrl must be either called with a string url, with an <a> tag as its context, or with an event whose currentTarget is an <a> tag`
      )
    );
  }

  const current = parseUri(window.location.href); // 当前地址的a
  const destination = parseUri(url); // 目标地址的 a 标签

  /**
   * 1.如果传入的url为仅hash值，则调整当前hash【window.location.hash】
   * 2.如果传入的url对应的host不同，则跳转【window.location.href】到传入的url
   * 3.如果传入的url对应的pathname、search 【路径和参数】都相同。调整当前hash【window.location.hash】为目标hash
   * 4.否则，将url推入history的state中
   * 
   */
  if (url.indexOf("#") === 0) {
    window.location.hash = destination.hash;
  } else if (current.host !== destination.host && destination.host) {
    if (process.env.BABEL_ENV === "test") {
      return { wouldHaveReloadedThePage: true };
    } else {
      window.location.href = url;
    }
  } else if (
    destination.pathname === current.pathname &&
    destination.search === current.search
  ) {
    window.location.hash = destination.hash;
  } else {
    // different path, host, or query params
    window.history.pushState(null, null, url);
  }
}

/**
 * 执行上文 capturedEventListeners 中存储的事件
 * @param {*} eventArguments 事件参数
 */
export function callCapturedEventListeners(eventArguments) {
  if (eventArguments) {
    const eventType = eventArguments[0].type;
    if (routingEventsListeningTo.indexOf(eventType) >= 0) {
      capturedEventListeners[eventType].forEach((listener) => {
        try {
          // 应用程序事件侦听器引发的错误不应破坏 single-spa。所以要放在try catch中

          // The error thrown by application event listener should not break single-spa down.
          // Just like https://github.com/single-spa/single-spa/blob/85f5042dff960e40936f3a5069d56fc9477fac04/src/navigation/reroute.js#L140-L146 did
          listener.apply(this, eventArguments);
        } catch (e) {
          setTimeout(() => {
            throw e;
          });
        }
      });
    }
  }
}

let urlRerouteOnly;

/**
 * 设置仅在URL更改时重新进行路由
 * @param {*} val 
 */
export function setUrlRerouteOnly(val) {
  urlRerouteOnly = val;
}

function urlReroute() {
  reroute([], arguments);
}

/**
 * 【劫持原生pushState、和replaceState】调用原生方法后 决定是否需要对微应用进行路由
 *  1. 获取到调用前后的url, 以及single-spa启动时传入的urlRerouteOnly【默认为false】
 *  2. urlRerouteOnly默认为false,只要调用了方法，就会走内部逻辑
 *  3. urlRerouteOnly设置为true是，则只有调用前后的url不同时才走内部逻辑
 *     内部逻辑：
 *        single-spa已启动: 执行人为自定义事件，以便微应用知道其他微应用的路由事件
 *        single-spa未启动  执行reroute， 不要触发人为的popstate事件，因为没启动时应用不需要知道其他应用的路由事件
 * @param {*} updateState pushState | replaceState
 * @param {*} methodName  方法名
 * @returns 
 */
function patchedUpdateState(updateState, methodName) {
  return function () {
    const urlBefore = window.location.href;
    const result = updateState.apply(this, arguments);
    const urlAfter = window.location.href;

    //urlRerouteOnly 默认为undefined ，如果设置为true，则只有在urlBefore !== urlAfter 时才执行reroute
    if (!urlRerouteOnly || urlBefore !== urlAfter) {
      if (isStarted()) {
        // fire an artificial popstate event once single-spa is started, 
        // so that single-spa applications know about routing that 
        // occurs in a different application

        //single-spa一旦启动，就会触发人为popstate事件，以便微应用知道其他微应用的路由事件
        window.dispatchEvent(
          createPopStateEvent(window.history.state, methodName)
        );
      } else {
        // do not fire an artificial popstate event before single-spa is started,
        // since no single-spa applications need to know about routing events
        // outside of their own router.

        // 在single-spa启动前，不要触发人为的popstate事件，因为微应用不需要知道其他微应用的路由事件
        reroute([]);
      }
    }

    return result;
  };
}

/**
 * 创建一个popstate事件
 * @param {*} state 
 * @param {*} originalMethodName 
 * @returns 
 */
function createPopStateEvent(state, originalMethodName) {
  // https://github.com/single-spa/single-spa/issues/224 and https://github.com/single-spa/single-spa-angular/issues/49
  // We need a popstate event even though the browser doesn't do one by default when you call replaceState, so that
  // all the applications can reroute. We explicitly identify this extraneous event by setting singleSpa=true and
  // singleSpaTrigger=<pushState|replaceState> on the event instance.
  let evt;
  try {
    evt = new PopStateEvent("popstate", { state });
  } catch (err) {
    // IE 11 compatibility https://github.com/single-spa/single-spa/issues/299
    // https://docs.microsoft.com/en-us/openspecs/ie_standards/ms-html5e/bd560f47-b349-4d2c-baa8-f1560fb489dd
    evt = document.createEvent("PopStateEvent");
    evt.initPopStateEvent("popstate", false, false, state);
  }
  evt.singleSpa = true;
  evt.singleSpaTrigger = originalMethodName;
  return evt;
}

if (isInBrowser) {
  // We will trigger an app change for any routing events.
  // 我们将为任何路由事件触发应用程序更改

  window.addEventListener("hashchange", urlReroute);
  window.addEventListener("popstate", urlReroute);

  // Monkeypatch addEventListener so that we can ensure correct timing
  /**
   * 劫持 addEventListener 中popstate/hashchange事件 以便我们可以确保正确的计时
   * 1.重写 window.addEventListener
   * 2.如果监听事件是popstate或者hashchange,则将其执行函数缓存到capturedEventListeners。 后返回
   * 3.其他事件，则执行原生addEventListener
   */
  const originalAddEventListener = window.addEventListener;
  const originalRemoveEventListener = window.removeEventListener;
  window.addEventListener = function (eventName, fn) {
    if (typeof fn === "function") {
      if (
        routingEventsListeningTo.indexOf(eventName) >= 0 &&
        !find(capturedEventListeners[eventName], (listener) => listener === fn)
      ) {
        capturedEventListeners[eventName].push(fn);
        return;
      }
    }

    return originalAddEventListener.apply(this, arguments);
  };

  window.removeEventListener = function (eventName, listenerFn) {
    if (typeof listenerFn === "function") {
      if (routingEventsListeningTo.indexOf(eventName) >= 0) {
        capturedEventListeners[eventName] = capturedEventListeners[
          eventName
        ].filter((fn) => fn !== listenerFn);
        return;
      }
    }

    return originalRemoveEventListener.apply(this, arguments);
  };

  // 劫持pushState
  window.history.pushState = patchedUpdateState(
    window.history.pushState,
    "pushState"
  );
  // 劫持replaceState
  window.history.replaceState = patchedUpdateState(
    window.history.replaceState,
    "replaceState"
  );

  // single-spa 已在页面上加载过。
  if (window.singleSpaNavigate) {
    console.warn(
      formatErrorMessage(
        41,
        __DEV__ &&
        "single-spa has been loaded twice on the page. This can result in unexpected behavior."
      )
    );
  } else {
    /* For convenience in `onclick` attributes, we expose a global function for navigating to
     * whatever an <a> tag's href is.
     */
    // 为了方便 `onclick` 属性，我们公开了一个全局函数，用于导航到 <a> 标记的 href 是什么。
    window.singleSpaNavigate = navigateToUrl;
  }
}

/**
 * 创建a标签，href指向传入的str
 * @param {string} str 
 * @returns 
 */
function parseUri(str) {
  const anchor = document.createElement("a");
  anchor.href = str;
  return anchor;
}

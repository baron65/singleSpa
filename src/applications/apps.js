import { ensureJQuerySupport } from "../jquery-support.js";
import {
  isActive,
  toName,
  NOT_LOADED,
  NOT_BOOTSTRAPPED,
  NOT_MOUNTED,
  MOUNTED,
  LOAD_ERROR,
  SKIP_BECAUSE_BROKEN,
  LOADING_SOURCE_CODE,
  shouldBeActive,
} from "./app.helpers.js";
import { reroute } from "../navigation/reroute.js";
import { find } from "../utils/find.js";
import { toUnmountPromise } from "../lifecycles/unmount.js";
import {
  toUnloadPromise,
  getAppUnloadInfo,
  addAppToUnload,
} from "../lifecycles/unload.js";
import { formatErrorMessage } from "./app-errors.js";
import { isInBrowser } from "../utils/runtime-environment.js";
import { assign } from "../utils/assign";

// 所有接入微前端的app
const apps = [];

/**
 * 获取下一步要变动【需要 加载 | 挂载 | 解除挂载 | 卸载】 的应用
 * @returns 
 */
export function getAppChanges() {
  const appsToUnload = [], //要卸载的子应用
    appsToUnmount = [], //要解除挂载的子应用
    appsToLoad = [], //要加载的子应用
    appsToMount = []; //要挂载的子应用

  // We re-attempt to download applications in LOAD_ERROR after a timeout of 200 milliseconds
  // 超时200毫秒后，我们重新尝试在 LOAD_ERROR 中下载 app
  const currentTime = new Date().getTime();

  apps.forEach((app) => {
    //app是否处于激活状态
    const appShouldBeActive =
      app.status !== SKIP_BECAUSE_BROKEN && shouldBeActive(app);

    switch (app.status) {
      case LOAD_ERROR:
        if (appShouldBeActive && currentTime - app.loadErrorTime >= 200) {
          appsToLoad.push(app);
        }
        break;
      case NOT_LOADED:
      case LOADING_SOURCE_CODE:
        if (appShouldBeActive) {
          appsToLoad.push(app);
        }
        break;
      case NOT_BOOTSTRAPPED:
      case NOT_MOUNTED:
        if (!appShouldBeActive && getAppUnloadInfo(toName(app))) {
          appsToUnload.push(app);
        } else if (appShouldBeActive) {
          appsToMount.push(app);
        }
        break;
      case MOUNTED:
        if (!appShouldBeActive) {
          appsToUnmount.push(app);
        }
        break;
      // all other statuses are ignored
    }
  });

  return { appsToUnload, appsToUnmount, appsToLoad, appsToMount };
}

/**
 * 获取已挂载的应用名
 * @returns 
 */
export function getMountedApps() {
  return apps.filter(isActive).map(toName);
}

/**
 * 获取所有应用名
 * @returns 
 */
export function getAppNames() {
  return apps.map(toName);
}

/**
 * 获取原始应用数据。
 * 仅在 devtools 中使用，不作为single-spa API 公开
 * @returns 
 */
export function getRawAppData() {
  return [...apps];
}

/**
 * 获取指定应用的状态
 * @param {string} appName 
 * @returns 
 */
export function getAppStatus(appName) {
  const app = find(apps, (app) => toName(app) === appName);
  return app ? app.status : null;
}

/**
 * 应用注册api
 *    1.清洗整理入参
 *    2.apps是否已包含要注册的应用，有，则抛错
 *    3.给要注册的应用增加内部属性 
 *      loadErrorTime  加载错误时记录事件
 *      status         应用的状态
 *      parcels        包裹
 *      devtools:{overlays:{options:{},selectors:[]}}
 *    4.将其push到apps中
 *    5.执行重新路由
 * @param {string|object} appNameOrConfig 应用名字或者配置
 * @param {func|app} appOrLoadApp 加载函数或者promise类型的app【加载好的app】
 * @param {func} activeWhen 必须是个纯函数, 该函数由window.location作为第一个参数被调用, 当应用应该被激活时它应该返回一个真值。
 * @param {object} customProps 子应用生命周期钩子函数 执行时传入的参数
 */
export function registerApplication(
  appNameOrConfig,
  appOrLoadApp,
  activeWhen,
  customProps
) {
  const registration = sanitizeArguments(
    appNameOrConfig,
    appOrLoadApp,
    activeWhen,
    customProps
  );

  if (getAppNames().indexOf(registration.name) !== -1)
    throw Error(
      formatErrorMessage(
        21,
        __DEV__ &&
        `There is already an app registered with name ${registration.name}`,
        registration.name
      )
    );

  apps.push(
    assign(
      {
        loadErrorTime: null,
        status: NOT_LOADED,
        parcels: {},
        devtools: {
          overlays: {
            options: {},
            selectors: [],
          },
        },
      },
      registration
    )
  );

  if (isInBrowser) {
    ensureJQuerySupport();
    reroute();
  }
}

/**
 * 检查当前location下能激活的app
 * @param {*} location 
 * @returns 返回激活状态的app名字数组
 */
export function checkActivityFunctions(location = window.location) {
  return apps.filter((app) => app.activeWhen(location)).map(toName);
}

/**
 * 注销应用
 *    1.apps中是否有要注销的应用，如果没有抛错
 *    2.完成应用卸载过程 unloadApplication(appName)
 *    3.从apps中删除对应的数据
 * @param {*} appName 
 * @returns 
 */
export function unregisterApplication(appName) {
  if (apps.filter((app) => toName(app) === appName).length === 0) {
    throw Error(
      formatErrorMessage(
        25,
        __DEV__ &&
        `Cannot unregister application '${appName}' because no such application has been registered`,
        appName
      )
    );
  }

  return unloadApplication(appName).then(() => {
    const appIndex = apps.map(toName).indexOf(appName);
    apps.splice(appIndex, 1);
  });
}

/**
 * 卸载应用程序
 *   waitForUnmount
 * @param {*} appName 
 * @param {*} opts waitForUnmount 是否等待其他已有卸载完成
 * @returns 
 */
export function unloadApplication(appName, opts = { waitForUnmount: false }) {
  if (typeof appName !== "string") {
    throw Error(
      formatErrorMessage(
        26,
        __DEV__ && `unloadApplication requires a string 'appName'`
      )
    );
  }
  const app = find(apps, (App) => toName(App) === appName);
  if (!app) {
    throw Error(
      formatErrorMessage(
        27,
        __DEV__ &&
        `Could not unload application '${appName}' because no such application has been registered`,
        appName
      )
    );
  }

  const appUnloadInfo = getAppUnloadInfo(toName(app));
  if (opts && opts.waitForUnmount) {
    // We need to wait for unmount before unloading the app
    // 在卸载应用程序之前，我们需要等待卸载

    if (appUnloadInfo) {
      // 其他人也已经在等待这个，则直接返回它的promise对象
      return appUnloadInfo.promise;
    } else {
      // 我们是第一个希望解决该应用程序的人。
      const promise = new Promise((resolve, reject) => {
        addAppToUnload(app, () => promise, resolve, reject);
      });
      return promise;
    }
  } else {// 不等待

    // 我们应该解除挂载该应用，卸载它，然后立即重新挂载它。
    let resultPromise;

    if (appUnloadInfo) { // 其他人也已经在等待这个
      resultPromise = appUnloadInfo.promise;
      immediatelyUnloadApp(app, appUnloadInfo.resolve, appUnloadInfo.reject);
    } else {
      // 我们是第一个希望解决该应用程序的人。
      resultPromise = new Promise((resolve, reject) => {
        addAppToUnload(app, () => resultPromise, resolve, reject);
        immediatelyUnloadApp(app, resolve, reject);
      });
    }

    return resultPromise;
  }
}

/**
 * 立即卸载应用程序
 *    1.解除app的挂载
 *    2.卸载app
 *    3.执行resolve，
 *    4.卸载promise完成后，重新路由
 * @param {*} app 
 * @param {*} resolve 
 * @param {*} reject 
 */
function immediatelyUnloadApp(app, resolve, reject) {
  toUnmountPromise(app)
    .then(toUnloadPromise)
    .then(() => {
      resolve();
      setTimeout(() => {
        // reroute, but the unload promise is done
        reroute();
      });
    })
    .catch(reject);
}

/**
 * 校验注册应用时的参数
 * @param {*} config 
 */
function validateRegisterWithArguments(
  name,
  appOrLoadApp,
  activeWhen,
  customProps
) {
  if (typeof name !== "string" || name.length === 0)
    throw Error(
      formatErrorMessage(
        20,
        __DEV__ &&
        `The 1st argument to registerApplication must be a non-empty string 'appName'`
      )
    );

  if (!appOrLoadApp)
    throw Error(
      formatErrorMessage(
        23,
        __DEV__ &&
        "The 2nd argument to registerApplication must be an application or loading application function"
      )
    );

  if (typeof activeWhen !== "function")
    throw Error(
      formatErrorMessage(
        24,
        __DEV__ &&
        "The 3rd argument to registerApplication must be an activeWhen function"
      )
    );

  if (!validCustomProps(customProps))
    throw Error(
      formatErrorMessage(
        22,
        __DEV__ &&
        "The optional 4th argument is a customProps and must be an object"
      )
    );
}

/**
 * 校验注册应用时的对象参数
 * @param {*} config 
 */
export function validateRegisterWithConfig(config) {
  if (Array.isArray(config) || config === null)
    throw Error(
      formatErrorMessage(
        39,
        __DEV__ && "Configuration object can't be an Array or null!"
      )
    );
  const validKeys = ["name", "app", "activeWhen", "customProps"];
  // 找到非validKeys中的key
  const invalidKeys = Object.keys(config).reduce(
    (invalidKeys, prop) =>
      validKeys.indexOf(prop) >= 0 ? invalidKeys : invalidKeys.concat(prop),
    []
  );
  if (invalidKeys.length !== 0)
    throw Error(
      formatErrorMessage(
        38,
        __DEV__ &&
        `The configuration object accepts only: ${validKeys.join(
          ", "
        )}. Invalid keys: ${invalidKeys.join(", ")}.`,
        validKeys.join(", "),
        invalidKeys.join(", ")
      )
    );
  if (typeof config.name !== "string" || config.name.length === 0)
    throw Error(
      formatErrorMessage(
        20,
        __DEV__ &&
        "The config.name on registerApplication must be a non-empty string"
      )
    );
  if (typeof config.app !== "object" && typeof config.app !== "function")
    throw Error(
      formatErrorMessage(
        20,
        __DEV__ &&
        "The config.app on registerApplication must be an application or a loading function"
      )
    );
  const allowsStringAndFunction = (activeWhen) =>
    typeof activeWhen === "string" || typeof activeWhen === "function";
  if (
    !allowsStringAndFunction(config.activeWhen) &&
    !(
      Array.isArray(config.activeWhen) &&
      config.activeWhen.every(allowsStringAndFunction)
    )
  )
    throw Error(
      formatErrorMessage(
        24,
        __DEV__ &&
        "The config.activeWhen on registerApplication must be a string, function or an array with both"
      )
    );
  if (!validCustomProps(config.customProps))
    throw Error(
      formatErrorMessage(
        22,
        __DEV__ && "The optional config.customProps must be an object"
      )
    );
}

/**
 * 校验主应用传入子应用的参数
 *    1.必须传
 *    2.可以是函数
 *    3.也可以是非数组且非null的对象
 * @param {*} customProps 
 * @returns 
 */
function validCustomProps(customProps) {
  return (
    !customProps ||
    typeof customProps === "function" ||
    (typeof customProps === "object" &&
      customProps !== null &&
      !Array.isArray(customProps))
  );
}

/**
 * 处理（消毒）参数
 *    1.参数错误时，抛错
 *    2.确保：应用名类型为 string 且不为 ''
 *            应用加载器 必传 类型要么是object，要么是function
 *            应用激活器必须为string 或 function 且最终整合为function 
 *            主应用传入子应用的数据类型为 非null对象 或 数组
 * @param {*} appNameOrConfig 
 * @param {*} appOrLoadApp 
 * @param {*} activeWhen 
 * @param {*} customProps 
 * @returns { name, loadApp, activeWhen, customProps}
 */
function sanitizeArguments(
  appNameOrConfig,
  appOrLoadApp,
  activeWhen,
  customProps
) {
  const usingObjectAPI = typeof appNameOrConfig === "object";

  const registration = {
    name: null,
    loadApp: null,
    activeWhen: null,
    customProps: null,
  };

  if (usingObjectAPI) {
    registration.name = appNameOrConfig.name;
    validateRegisterWithConfig(appNameOrConfig);
    registration.loadApp = appNameOrConfig.app;
    registration.activeWhen = appNameOrConfig.activeWhen;
    registration.customProps = appNameOrConfig.customProps;
  } else {
    validateRegisterWithArguments(
      appNameOrConfig,
      appOrLoadApp,
      activeWhen,
      customProps
    );
    registration.name = appNameOrConfig;
    registration.loadApp = appOrLoadApp;
    registration.activeWhen = activeWhen;
    registration.customProps = customProps;
  }

  registration.loadApp = sanitizeLoadApp(registration.loadApp);
  registration.customProps = sanitizeCustomProps(registration.customProps);
  registration.activeWhen = sanitizeActiveWhen(registration.activeWhen);

  return registration;
}

/**
 * 处理（消毒）loadApp:
 *    需要保证loadApp 是一个函数，如果不是，则将其包裹为一个函数，且该函数返回pormise
 * @param {*} loadApp 
 * @returns 
 */
function sanitizeLoadApp(loadApp) {
  if (typeof loadApp !== "function") {
    return () => Promise.resolve(loadApp);
  }

  return loadApp;
}

// 确保 主应用传递给微应用的数据 不为空
function sanitizeCustomProps(customProps) {
  return customProps ? customProps : {};
}

/**
 * 处理（消毒）activeWhen:
 *    1. 整合为数组。传入的activeWhen可以是单个字符串/函数，也可以是两者的数组。需要判断整合
 *    2. 确保上述整合数组中的元素都是函数。如果不是函数，转为接受location参数的函数。
 *    3. 返回整体函数，返回上述整合数组执行中为true。
 * @param {*} activeWhen 
 * @returns 
 */
function sanitizeActiveWhen(activeWhen) {
  // 整合为数组
  let activeWhenArray = Array.isArray(activeWhen) ? activeWhen : [activeWhen];

  // 将activeWhen全部转为接受window.location参数的函数。【activeWhen可能为字符串】
  activeWhenArray = activeWhenArray.map((activeWhenOrPath) =>
    typeof activeWhenOrPath === "function"
      ? activeWhenOrPath
      : pathToActiveWhen(activeWhenOrPath)
  );

  return (location) =>
    activeWhenArray.some((activeWhen) => activeWhen(location));
}

/**
 * 将字符串路径转为activeWhen函数
 * @param {string} path 用户传入的activeWhen字符串
 * @param {boolean} exactMatch 完全符合。严格匹配？
 * @returns activeWhen函数
 */
export function pathToActiveWhen(path, exactMatch) {
  const regex = toDynamicPathValidatorRegex(path, exactMatch);

  return (location) => {
    // compatible with IE10
    let origin = location.origin;
    if (!origin) {
      origin = `${location.protocol}//${location.host}`;
    }
    const route = location.href
      .replace(origin, "")
      .replace(location.search, "")
      .split("?")[0];
    return regex.test(route);
  };
}

/**
 * 动态路径校验的正则表达式。例如： /users/:userId/profile'  
 * @param {string} path 用户传入的activeWhen字符串
 * @param {boolean} exactMatch 完全符合。严格匹配？
 * @returns 正则表达式regex
 */
function toDynamicPathValidatorRegex(path, exactMatch) {
  let lastIndex = 0,
    inDynamic = false, //动态flag
    regexStr = "^";

  // 确保path用/开头
  if (path[0] !== "/") {
    path = "/" + path;
  }

  for (let charIndex = 0; charIndex < path.length; charIndex++) {
    const char = path[charIndex];
    const startOfDynamic = !inDynamic && char === ":";
    const endOfDynamic = inDynamic && char === "/";
    if (startOfDynamic || endOfDynamic) {
      // 执行两次，动态路劲开始和动态路径结束时
      appendToRegex(charIndex);
    }
  }

  appendToRegex(path.length);
  return new RegExp(regexStr, "i");

  function appendToRegex(index) {
    // 任何字符可能尾随斜杠正则表达式 。
    // 1.[^/]匹配非/的所有字符
    // 2.[^/]+ 匹配1次或多次非/的所有字符
    const anyCharMaybeTrailingSlashRegex = "[^/]+/?";
    const commonStringSubPath = escapeStrRegex(path.slice(lastIndex, index));

    regexStr += inDynamic
      ? anyCharMaybeTrailingSlashRegex
      : commonStringSubPath;
    console.log('regexStr', regexStr);

    if (index === path.length) {
      if (inDynamic) {
        if (exactMatch) {
          // Ensure exact match paths that end in a dynamic portion don't match
          // urls with characters after a slash after the dynamic portion.
          // 翻译：确保以动态部分结尾的完全匹配路径不会与动态部分后斜线后的字符匹配 url
          regexStr += "$";
        }
      } else {
        // For exact matches, expect no more characters. Otherwise, allow any characters. 
        // 对于完全匹配，不需要更多字符。否则，允许任何字符。
        const suffix = exactMatch ? "" : ".*";

        regexStr =
          // 1.因为我们不能使用 es6 方法 endsWith，故使用 charAt 代替
          // 2.判断末尾是否有/:
          // 有则表示输入的path只是一个url的子路径，不需要考虑路径的serach参数匹配
          // 没有，则需要考虑search参数及后面的匹配

          regexStr.charAt(regexStr.length - 1) === "/"
            ? `${regexStr}${suffix}$`
            : `${regexStr}(/${suffix})?(#.*)?$`;
      }
    }

    inDynamic = !inDynamic;
    lastIndex = index;
  }

  // 转义具有特殊含义的字符。
  function escapeStrRegex(str) {
    // borrowed from https://github.com/sindresorhus/escape-string-regexp/blob/master/index.js
    return str.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
  }
}

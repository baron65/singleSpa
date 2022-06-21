import { objectType, toName } from "./app.helpers";


/**
 * app-errors.js app异常处理
 */


// 异常处理器池：存放异常处理逻辑函数
let errorHandlers = [];

/**
 * 执行所有异常处理逻辑行数
 * @param {*} err 
 * @param {*} app 
 * @param {*} newStatus 
 */
export function handleAppError(err, app, newStatus) {
  const transformedErr = transformErr(err, app, newStatus);

  if (errorHandlers.length) {
    errorHandlers.forEach((handler) => handler(transformedErr));
  } else {
    setTimeout(() => {
      throw transformedErr;
    });
  }
}

/**
 * 添加异常处理逻辑
 * @param {*} handler 
 */
export function addErrorHandler(handler) {
  if (typeof handler !== "function") {
    throw Error(
      formatErrorMessage(
        28,
        __DEV__ && "a single-spa error handler must be a function"
      )
    );
  }

  errorHandlers.push(handler);
}

/**
 * 移除异常处理逻辑
 * @param {*} handler 
 */
export function removeErrorHandler(handler) {
  if (typeof handler !== "function") {
    throw Error(
      formatErrorMessage(
        29,
        __DEV__ && "a single-spa error handler must be a function"
      )
    );
  }

  let removedSomething = false;
  errorHandlers = errorHandlers.filter((h) => {
    const isHandler = h === handler;
    removedSomething = removedSomething || isHandler;
    return !isHandler;
  });

  // 返回是否移除成功
  return removedSomething;
}

/**
 * 格式化错误信息
 * @param {*} code 错误码
 * @param {*} msg 错误信息
 * @param  {...any} args 地址参数信息
 * @returns 
 */
export function formatErrorMessage(code, msg, ...args) {
  return `single-spa minified message #${code}: ${msg ? msg + " " : ""
    }See https://single-spa.js.org/error/?code=${code}${args.length ? `&arg=${args.join("&arg=")}` : ""
    }`;
}

/**
 * 转换错误。返回一个格式化转换后的错误对象
 * @param {*} ogErr 
 * @param {*} appOrParcel 
 * @param {*} newStatus 
 * @returns 
 */
export function transformErr(ogErr, appOrParcel, newStatus) {
  // 抛错前缀
  const errPrefix = `${objectType(appOrParcel)} '${toName(
    appOrParcel
  )}' died in status ${appOrParcel.status}: `;

  let result;

  if (ogErr instanceof Error) {
    try {
      ogErr.message = errPrefix + ogErr.message;
    } catch (err) {
      /* Some errors have read-only message properties, in which case there is nothing
       * that we can do.
       */
    }
    result = ogErr;
  } else {
    console.warn(
      formatErrorMessage(
        30,
        __DEV__ &&
        `While ${appOrParcel.status}, '${toName(
          appOrParcel
        )}' rejected its lifecycle function promise with a non-Error. This will cause stack traces to not be accurate.`,
        appOrParcel.status,
        toName(appOrParcel)
      )
    );
    try {
      // 将ogErr 包装为一个Error对象
      result = Error(errPrefix + JSON.stringify(ogErr));
    } catch (err) {
      // 如果它不是一个错误并且你不能对其进行字符串化，那么你还能对它做些什么呢？
      // If it's not an Error and you can't stringify it, then what else can you even do to it?
      result = ogErr;
    }
  }

  result.appOrParcelName = toName(appOrParcel);

  // 我们在转换错误后设置状态，以便错误消息引用 应用程序在状态更改之前所处的状态。 

  // We set the status after transforming the error so that the error message
  // references the state the application was in before the status change.
  appOrParcel.status = newStatus;

  return result;
}

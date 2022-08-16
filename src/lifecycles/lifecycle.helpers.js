import { find } from "../utils/find.js";
import { objectType, toName } from "../applications/app.helpers.js";
import { formatErrorMessage } from "../applications/app-errors.js";

export function validLifecycleFn(fn) {
  return fn && (typeof fn === "function" || isArrayOfFns(fn));

  function isArrayOfFns(arr) {
    return (
      Array.isArray(arr) && !find(arr, (item) => typeof item !== "function")
    );
  }
}

// 摊平 函数数组
export function flattenFnArray(appOrParcel, lifecycle) {
  // 获取到appOrParcel对应生命周期钩子的函数数组
  let fns = appOrParcel[lifecycle] || [];

  // 如果不是数组则包装成数组
  fns = Array.isArray(fns) ? fns : [fns];

  //如果为空，则装入一个返回空的promise函数
  if (fns.length === 0) {
    fns = [() => Promise.resolve()];
  }

  // 判断是包裹还是app
  const type = objectType(appOrParcel);

  // 获取名字
  const name = toName(appOrParcel);

  return function (props) {
    // 利用reduce 实现同步调用fns中的promise函数。如果其中函数执行结束后返回的不是promise，抛错
    return fns.reduce((resultPromise, fn, index) => {
      return resultPromise.then(() => {
        const thisPromise = fn(props);
        return smellsLikeAPromise(thisPromise)
          ? thisPromise
          : Promise.reject(
            formatErrorMessage(
              15,
              __DEV__ &&
              `Within ${type} ${name}, the lifecycle function ${lifecycle} at array index ${index} did not return a promise`,
              type,
              name,
              lifecycle,
              index
            )
          );
      });
    }, Promise.resolve());
  };
}

// 看起来像是promise
export function smellsLikeAPromise(promise) {
  return (
    promise &&
    typeof promise.then === "function" &&
    typeof promise.catch === "function"
  );
}

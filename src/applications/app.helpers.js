import { handleAppError } from "./app-errors.js";

// App statuses
export const NOT_LOADED = "NOT_LOADED"; // 未加载
export const LOADING_SOURCE_CODE = "LOADING_SOURCE_CODE"; // 加载源代码中
export const NOT_BOOTSTRAPPED = "NOT_BOOTSTRAPPED"; //未启动
export const BOOTSTRAPPING = "BOOTSTRAPPING"; // 启动中
export const NOT_MOUNTED = "NOT_MOUNTED"; // 未挂载
export const MOUNTING = "MOUNTING"; // 挂载中
export const MOUNTED = "MOUNTED"; // 已挂载
export const UPDATING = "UPDATING"; // 更新中
export const UNMOUNTING = "UNMOUNTING"; // 卸载中
export const UNLOADING = "UNLOADING"; // 移除中
export const LOAD_ERROR = "LOAD_ERROR"; // 加载错误
export const SKIP_BECAUSE_BROKEN = "SKIP_BECAUSE_BROKEN"; //跳过 因为坏了

export function isActive(app) {
  return app.status === MOUNTED;
}

// 判断该子应用是否应该被激活
export function shouldBeActive(app) {
  try {
    return app.activeWhen(window.location);
  } catch (err) {
    handleAppError(err, app, SKIP_BECAUSE_BROKEN);
    return false;
  }
}

// 获取app的名字
export function toName(app) {
  return app.name;
}

// 判断是否是一个包装
export function isParcel(appOrParcel) {
  return Boolean(appOrParcel.unmountThisParcel);
}

// Parcel 包裹
export function objectType(appOrParcel) {
  return isParcel(appOrParcel) ? "parcel" : "application";
}

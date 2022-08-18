import {
  NOT_MOUNTED,
  MOUNTED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { handleAppError, transformErr } from "../applications/app-errors.js";
import { reasonableTime } from "../applications/timeouts.js";
import CustomEvent from "custom-event";
import { toUnmountPromise } from "./unmount.js";

//初次挂载结束前
let beforeFirstMountFired = false;
//初次挂载结束
let firstMountFired = false;

export function toMountPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    // 必须是未挂载状态才能执行挂载逻辑
    if (appOrParcel.status !== NOT_MOUNTED) {
      return appOrParcel;
    }

    // 向用户抛出初次挂载前的钩子事件
    if (!beforeFirstMountFired) {
      window.dispatchEvent(new CustomEvent("single-spa:before-first-mount"));
      beforeFirstMountFired = true;
    }

    //执行子系统导出的mount方法逻辑
    return reasonableTime(appOrParcel, "mount")
      .then(() => {
        // 更新状态为已挂载
        appOrParcel.status = MOUNTED;

        if (!firstMountFired) {
          // 对外发布初次挂载结束事件
          window.dispatchEvent(new CustomEvent("single-spa:first-mount"));
          firstMountFired = true;
        }

        return appOrParcel;
      })
      .catch((err) => {
        // If we fail to mount the appOrParcel, we should attempt to unmount it before putting in SKIP_BECAUSE_BROKEN
        // We temporarily put the appOrParcel into MOUNTED status so that toUnmountPromise actually attempts to unmount it instead of just doing a no-op.

        // 如果app挂载失败，在放入SKIP_Cause_Breaked之前，我们应该尝试卸载它
        // 我们暂时将appOrParcel置于挂载状态，这样toUnmountPromise实际上会尝试卸载它，而不仅仅是执行禁止操作。
        appOrParcel.status = MOUNTED;
        
        return toUnmountPromise(appOrParcel, true).then(
          setSkipBecauseBroken,
          setSkipBecauseBroken
        );

        function setSkipBecauseBroken() {
          if (!hardFail) {
            handleAppError(err, appOrParcel, SKIP_BECAUSE_BROKEN);
            return appOrParcel;
          } else {
            throw transformErr(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          }
        }
      });
  });
}

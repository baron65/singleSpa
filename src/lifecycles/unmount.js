import {
  UNMOUNTING,
  NOT_MOUNTED,
  MOUNTED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { handleAppError, transformErr } from "../applications/app-errors.js";
import { reasonableTime } from "../applications/timeouts.js";

/**
 * 
 * @param {*} appOrParcel app或者包裹
 * @param {boolean} hardFail 是否手动处理错误，false时，程序会让异常处理池中的处理
 * @returns 
 */
export function toUnmountPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    if (appOrParcel.status !== MOUNTED) {
      return appOrParcel;
    }
    appOrParcel.status = UNMOUNTING;

    //卸载所有子包裹
    const unmountChildrenParcels = Object.keys(
      appOrParcel.parcels
    ).map((parcelId) => appOrParcel.parcels[parcelId].unmountThisParcel());

    let parcelError;

    return Promise.all(unmountChildrenParcels)
      .then(unmountAppOrParcel, (parcelError) => {
        // then的第二个参数。在没有catch时，卸载子应用出错时，会被抛到这里来

        // There is a parcel unmount error  子裹包卸载错误
        return unmountAppOrParcel().then(() => {
          // Unmounting the app/parcel succeeded, but unmounting its children parcels did not
          // 包裹卸载成功，但未卸载其子包裹
          const parentError = Error(parcelError.message);
          if (hardFail) {
            throw transformErr(parentError, appOrParcel, SKIP_BECAUSE_BROKEN);
          } else {
            handleAppError(parentError, appOrParcel, SKIP_BECAUSE_BROKEN);
          }
        });
      })
      .then(() => appOrParcel);

    function unmountAppOrParcel() {
      // We always try to unmount the appOrParcel, even if the children parcels failed to unmount.
      // 我们总是尝试卸载appOrParcel，即使子包裹未能卸载
      return reasonableTime(appOrParcel, "unmount")
        .then(() => {
          // The appOrParcel needs to stay in a broken status if its children parcels fail to unmount
          // 如果其子包裹无法卸载，appOrParcel需要保持断开状态
          if (!parcelError) { //表示子包裹卸载没有出错
            appOrParcel.status = NOT_MOUNTED;
          }
        })
        .catch((err) => {
          // 表示app卸载出错了。即执行子应用的unmount函数出错
          if (hardFail) {
            throw transformErr(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          } else {
            handleAppError(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          }
        });
    }
  });
}

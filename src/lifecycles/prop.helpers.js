import * as singleSpa from "../single-spa.js";
import { mountParcel } from "../parcels/mount-parcel.js";
import { assign } from "../utils/assign.js";
import { isParcel, toName } from "../applications/app.helpers.js";
import { formatErrorMessage } from "../applications/app-errors.js";

export function getProps(appOrParcel) {
  const name = toName(appOrParcel);
  // ------处理customProps 开始----------
  let customProps =
    typeof appOrParcel.customProps === "function"
      ? appOrParcel.customProps(name, window.location)
      : appOrParcel.customProps;
  if (
    typeof customProps !== "object" ||
    customProps === null ||
    Array.isArray(customProps)
  ) {
    customProps = {};
    console.warn(
      formatErrorMessage(
        40,
        __DEV__ &&
        `single-spa: ${name}'s customProps function must return an object. Received ${customProps}`
      ),
      name,
      customProps
    );
  }
  // ------处理customProps 结束：customProps最终是个对象----------

  // 组合返回的数据 
  const result = assign({}, customProps, {
    // 当前子应用的名字
    name,
    // 挂载当前子应用的方法
    mountParcel: mountParcel.bind(appOrParcel),
    // singleSpa所有的api
    singleSpa,
  });

  // 如果是包，则返回中增加卸载自己的方法unmountSelf
  if (isParcel(appOrParcel)) {
    result.unmountSelf = appOrParcel.unmountThisParcel;
  }

  return result;
}

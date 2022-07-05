import {
  validLifecycleFn,
  flattenFnArray,
} from "../lifecycles/lifecycle.helpers.js";
import {
  NOT_BOOTSTRAPPED,
  NOT_MOUNTED,
  MOUNTED,
  LOADING_SOURCE_CODE,
  SKIP_BECAUSE_BROKEN,
  toName,
} from "../applications/app.helpers.js";
import { toBootstrapPromise } from "../lifecycles/bootstrap.js";
import { toMountPromise } from "../lifecycles/mount.js";
import { toUpdatePromise } from "../lifecycles/update.js";
import { toUnmountPromise } from "../lifecycles/unmount.js";
import { ensureValidAppTimeouts } from "../applications/timeouts.js";
import { formatErrorMessage } from "../applications/app-errors.js";

//包裹数
let parcelCount = 0;
const rootParcels = { parcels: {} };

// This is a public api, exported to users of single-spa
// 这是一个公共的api，导出给single-spa的用户
export function mountRootParcel() {
  return mountParcel.apply(rootParcels, arguments);
}

/**
 * 安装包裹
 * @param {*} config 
 * @param {*} customProps 
 * @returns 返回包裹好的协议
 */
export function mountParcel(config, customProps) {
  const owningAppOrParcel = this;

  // Validate inputs
  // 没有配置对象或配置加载函数 无法挂载包裹
  if (!config || (typeof config !== "object" && typeof config !== "function")) {
    throw Error(
      formatErrorMessage(
        2,
        __DEV__ &&
        "Cannot mount parcel without a config object or config loading function"
      )
    );
  }

  // 如果提供包裹名称，则必须是字符串
  if (config.name && typeof config.name !== "string") {
    throw Error(
      formatErrorMessage(
        3,
        __DEV__ &&
        `Parcel name must be a string, if provided. Was given ${typeof config.name}`,
        typeof config.name
      )
    );
  }

  // 自定义参数 必须是一个对象
  if (typeof customProps !== "object") {
    throw Error(
      formatErrorMessage(
        4,
        __DEV__ &&
        `Parcel ${name} has invalid customProps -- must be an object but was given ${typeof customProps}`,
        name,
        typeof customProps
      )
    );
  }

  // 如果没有作为道具提供的 domElement，则无法安装包裹
  if (!customProps.domElement) {
    throw Error(
      formatErrorMessage(
        5,
        __DEV__ &&
        `Parcel ${name} cannot be mounted without a domElement provided as a prop`,
        name
      )
    );
  }

  // 包裹数
  const id = parcelCount++;

  // 是否是通过配置加载函数的方式
  const passedConfigLoadingFunction = typeof config === "function";
  // 整合成函数方式
  const configLoadingFunction = passedConfigLoadingFunction
    ? config
    : () => Promise.resolve(config);

  // Internal representation 
  const parcel = {
    id,
    parcels: {},
    status: passedConfigLoadingFunction
      ? LOADING_SOURCE_CODE
      : NOT_BOOTSTRAPPED,
    customProps,
    parentName: toName(owningAppOrParcel),
    unmountThisParcel() {
      return mountPromise
        .then(() => {
          if (parcel.status !== MOUNTED) {
            throw Error(
              formatErrorMessage(
                6,
                __DEV__ &&
                `Cannot unmount parcel '${name}' -- it is in a ${parcel.status} status`,
                name,
                parcel.status
              )
            );
          }
          return toUnmountPromise(parcel, true);
        })
        .then((value) => {
          if (parcel.parentName) {
            delete owningAppOrParcel.parcels[parcel.id];
          }

          return value;
        })
        .then((value) => {
          resolveUnmount(value);
          return value;
        })
        .catch((err) => {
          parcel.status = SKIP_BECAUSE_BROKEN;
          rejectUnmount(err);
          throw err;
        });
    },
  };

  // We return an external representation
  let externalRepresentation;

  // Add to owning app or parcel
  owningAppOrParcel.parcels[id] = parcel;

  let loadPromise = configLoadingFunction();

  if (!loadPromise || typeof loadPromise.then !== "function") {
    throw Error(
      formatErrorMessage(
        7,
        __DEV__ &&
        `When mounting a parcel, the config loading function must return a promise that resolves with the parcel config`
      )
    );
  }

  loadPromise = loadPromise.then((config) => {
    if (!config) {
      throw Error(
        formatErrorMessage(
          8,
          __DEV__ &&
          `When mounting a parcel, the config loading function returned a promise that did not resolve with a parcel config`
        )
      );
    }

    const name = config.name || `parcel-${id}`;

    if (
      // ES Module objects don't have the object prototype
      Object.prototype.hasOwnProperty.call(config, "bootstrap") &&
      !validLifecycleFn(config.bootstrap)
    ) {
      throw Error(
        formatErrorMessage(
          9,
          __DEV__ && `Parcel ${name} provided an invalid bootstrap function`,
          name
        )
      );
    }

    if (!validLifecycleFn(config.mount)) {
      throw Error(
        formatErrorMessage(
          10,
          __DEV__ && `Parcel ${name} must have a valid mount function`,
          name
        )
      );
    }

    if (!validLifecycleFn(config.unmount)) {
      throw Error(
        formatErrorMessage(
          11,
          __DEV__ && `Parcel ${name} must have a valid unmount function`,
          name
        )
      );
    }

    if (config.update && !validLifecycleFn(config.update)) {
      throw Error(
        formatErrorMessage(
          12,
          __DEV__ && `Parcel ${name} provided an invalid update function`,
          name
        )
      );
    }

    const bootstrap = flattenFnArray(config, "bootstrap");
    const mount = flattenFnArray(config, "mount");
    const unmount = flattenFnArray(config, "unmount");

    parcel.status = NOT_BOOTSTRAPPED;
    parcel.name = name;
    parcel.bootstrap = bootstrap;
    parcel.mount = mount;
    parcel.unmount = unmount;
    parcel.timeouts = ensureValidAppTimeouts(config.timeouts);

    if (config.update) {
      parcel.update = flattenFnArray(config, "update");
      externalRepresentation.update = function (customProps) {
        parcel.customProps = customProps;

        return promiseWithoutReturnValue(toUpdatePromise(parcel));
      };
    }
  });

  // Start bootstrapping and mounting
  // The .then() causes the work to be put on the event loop instead of happening immediately
  const bootstrapPromise = loadPromise.then(() =>
    toBootstrapPromise(parcel, true)
  );
  const mountPromise = bootstrapPromise.then(() =>
    toMountPromise(parcel, true)
  );

  let resolveUnmount, rejectUnmount;

  const unmountPromise = new Promise((resolve, reject) => {
    resolveUnmount = resolve;
    rejectUnmount = reject;
  });

  externalRepresentation = {
    mount() {
      return promiseWithoutReturnValue(
        Promise.resolve().then(() => {
          if (parcel.status !== NOT_MOUNTED) {
            throw Error(
              formatErrorMessage(
                13,
                __DEV__ &&
                `Cannot mount parcel '${name}' -- it is in a ${parcel.status} status`,
                name,
                parcel.status
              )
            );
          }

          // Add to owning app or parcel
          owningAppOrParcel.parcels[id] = parcel;

          return toMountPromise(parcel);
        })
      );
    },
    unmount() {
      return promiseWithoutReturnValue(parcel.unmountThisParcel());
    },
    getStatus() {
      return parcel.status;
    },
    loadPromise: promiseWithoutReturnValue(loadPromise),
    bootstrapPromise: promiseWithoutReturnValue(bootstrapPromise),
    mountPromise: promiseWithoutReturnValue(mountPromise),
    unmountPromise: promiseWithoutReturnValue(unmountPromise),
  };

  return externalRepresentation;
}

function promiseWithoutReturnValue(promise) {
  return promise.then(() => null);
}

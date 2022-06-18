import { routingEventsListeningTo } from "./navigation/navigation-events.js";

// 是否被初始化
let hasInitialized = false;

/**
 * 目的：如果要让jquery技术栈能接入微前端，则需要提供监听路由变化事件的函数。故需要重写jquery的on/off方法
 * 
 * 做法：
 * 劫持jquery的on / off方法：并重写【加入window.addEventListener/removeEventListener 监听/释放 与路由相关的事件hashchange、popstate 】。
 * 1.使用on/off来监听hashchange、popstate事件
 * 2.jqueyr技术栈接入时：$.on('hashchange',()=>{
 *  do something
 * })
 * @param {*} jQuery 
 */
export function ensureJQuerySupport(jQuery = window.jQuery) {
  if (!jQuery) {
    if (window.$ && window.$.fn && window.$.fn.jquery) {
      jQuery = window.$;
    }
  }

  if (jQuery && !hasInitialized) {
    // jquery原型上的on方法
    const originalJQueryOn = jQuery.fn.on;

    // jquery原型上的off方法
    const originalJQueryOff = jQuery.fn.off;

    jQuery.fn.on = function (eventString, fn) {
      return captureRoutingEvents.call(
        this,
        originalJQueryOn,
        window.addEventListener,
        eventString,
        fn,
        arguments
      );
    };

    jQuery.fn.off = function (eventString, fn) {
      return captureRoutingEvents.call(
        this,
        originalJQueryOff,
        window.removeEventListener,
        eventString,
        fn,
        arguments
      );
    };

    // 已经被初始化了，确保劫持on/off逻辑只执行一次
    hasInitialized = true;
  }
}

/**
 * 捕获路由事件
 * @param {*} originalJQueryFunction jquery本身事件函数
 * @param {*} nativeFunctionToCall  window原生监听函数
 * @param {*} eventString 事件str 可以用空格连接多个事件
 * @param {*} fn callback。路由变化的回调函数
 * @param {*} originalArgs jquery on/off其他参数 arguments
 * @returns 
 */
function captureRoutingEvents(
  originalJQueryFunction,
  nativeFunctionToCall,
  eventString,
  fn,
  originalArgs
) {
  // 如果传入的事件名称不是string，则直接调用jquery原型上对应的方法
  if (typeof eventString !== "string") {
    return originalJQueryFunction.apply(this, originalArgs);
  }

  // 切分eventString为数组 【不管多少空格】
  const eventNames = eventString.split(/\s+/);

  // 遍历事件数组
  eventNames.forEach((eventName) => {
    // routingEventsListeningTo = ["hashchange", "popstate"];
    if (routingEventsListeningTo.indexOf(eventName) >= 0) {
      // 如果是 "hashchange" 或 "popstate", 使用window.addEventListener执行该事件
      nativeFunctionToCall(eventName, fn);

      // 去掉eventString中已经执行的上述事件字符
      eventString = eventString.replace(eventName, "");
    }
  });

  // 表示没有其他事件需要执行
  if (eventString.trim() === "") {

    // 返回jquery的原型
    return this;

  } else {

    // 表示还有其他事件，则jquery本身监听方法on/off执行剩余
    return originalJQueryFunction.apply(this, originalArgs);
  }
}

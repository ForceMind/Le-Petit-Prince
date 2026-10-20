/* 浏览器加载策略。缓存版本（CACHE_VERSION）与页面显示的构建版本无关。
 * 只有缓存格式或兼容性本身改变时才动它，正常发布永远不改。
 */
(function (root) {
  "use strict";
  // 缓存版本锚点：固定为切换时线上正在用的 productVersion "0.1.0+4a120fa1"
  // （2026-10-11 02:59 部署的八章英文排版正式包）。Unity loader 的 cleanUpCache 会删掉
  // version 与当前 productVersion 不同的缓存条目，锚在线上值上，老玩家已缓存的
  // 章节包在切换后照样命中。此后这个值永远不随构建变化，不要改成新构建的提交号。
  var CACHE_VERSION = "0.1.0+4a120fa1";
  var hash = "[a-f0-9]{32}";
  var bundle = new RegExp("/StreamingAssets/aa/[^/]+/[^/]+_" + hash + "\\.bundle$", "i");
  var data = new RegExp("/Build/" + hash + "\\.data(?:\\.br)?$", "i");

  function cacheControl(url) {
    var path;
    try { path = new URL(url, root.location.href).pathname; }
    catch (_) { return "no-store"; }
    // Unhashed catalogs/settings must never inherit the immutable policy.
    return bundle.test(path) || data.test(path) ? "immutable" : "no-store";
  }

  function installDownloadMeter() {
    if (root.__lpNet) return root.__lpNet;
    var original = root.fetch;
    var net = root.__lpNet = { entries: {} };
    // 其他请求原样转发，只记下下载失败的地址（net.failed）：被拦截或断网的下载往往在后面变成不相干的 TypeError，
    // 首页的 showMessage 据此改说「网络中断或文件被拦截」。旁挂一个 catch，返回的仍是原来那个 promise。
    function passthrough(self, args, url) {
      var request = original.apply(self, args);
      if (request && typeof request.catch === "function") request.catch(function () { net.failed = url; });
      return request;
    }
    root.fetch = function (input, init) {
      var url = typeof input === "string" ? input : input && input.url;
      var resolved, path;
      try { resolved = new URL(url, root.location.href); path = resolved.pathname; }
      catch (_) { return passthrough(this, arguments, url); }
      // Filename-based manifest entries describe this origin only.
      if (resolved.origin !== root.location.origin) return passthrough(this, arguments, url);
      if (!bundle.test(path) && !data.test(path)) return passthrough(this, arguments, url);
      var name = path.slice(path.lastIndexOf("/") + 1);
      var previous = net.entries[name];
      var entry = net.entries[name] = {
        loaded: 0, total: 0, done: false, cached: false, error: null,
        status: 0, attempt: previous ? previous.attempt + 1 : 1,
        started: performance.now(), lastByteAt: null, phase: "requesting"
      };
      function fail(error) {
        net.failed = url;
        entry.done = true;
        entry.phase = "failed";
        entry.error = String(error && error.message || error);
      }
      var request, identity = false;
      var transport = root.LPWebBundleTransport && root.LPWebBundleTransport[name];
      var requestArgs = arguments;
      // UnityCache still sees its original URL. Only a network miss uses the alternate HTTP representation.
      // Old pages continue requesting the untouched original; no CDN purge or cache migration is needed.
      var method = init && init.method || input && input.method || "GET";
      var requestHeaders = new Headers(init && init.headers || input && input.headers);
      if (transport && method.toUpperCase() === "GET" && !requestHeaders.has("Range")) {
        var alternate = new URL(transport.url, root.location.href);
        if (alternate.origin === root.location.origin && transport.decodedBytes === (root.LPWebDecodedSizes || {})[name]) {
          entry.transportUrl = alternate.href;
          identity = transport.encoding === "identity";
          requestArgs = [typeof input === "string" ? alternate.href : new Request(alternate.href, input), init];
        }
      }
      try { request = original.apply(this, requestArgs); }
      catch (error) { fail(error); throw error; }
      return request.then(function (response) {
        entry.status = response.status;
        if (response.status === 304) {
          entry.done = true; entry.cached = true; entry.phase = "cached";
          return response;
        }
        if (!response.ok) {
          fail("HTTP " + response.status);
          return response; // Preserve the response for Unity's own failure/retry handling.
        }
        if (!response.body) {
          entry.done = true; entry.phase = "complete";
          return response;
        }
        // fetch has already decoded Content-Encoding. Give Unity the exact decoded size so
        // its reader does not guess 2x Brotli size then allocate/copy another full buffer.
        var expected = root.LPWebDecodedSizes && root.LPWebDecodedSizes[name];
        var exact = Number.isSafeInteger(expected) && expected > 0;
        var headers = response.headers;
        entry.wireTotal = Number(headers.get("Content-Length")) || 0;
        // 原样传输（.raw）：线上字节就是包本身，长度已对，响应头原样交给 Unity（仍按期望长度逐块核对）。
        if (exact && response.status === 200 && !identity) {
          headers = new Headers(headers);
          headers.set("Content-Length", String(expected));
          headers.delete("Content-Encoding");
        } else if (!(exact && response.status === 200)) { exact = false; }
        entry.total = exact ? expected : entry.wireTotal;
        entry.phase = "downloading";
        var reader = response.body.getReader();
        var counted = new ReadableStream({
          pull: function (controller) {
            return reader.read().then(function (chunk) {
              if (entry.phase === "cancelled") return;
              if (chunk.done) {
                if (exact && entry.loaded !== expected) throw new Error("Decoded resource length mismatch: " + name);
                entry.done = true; entry.phase = "complete";
                controller.close(); return;
              }
              if (exact && entry.loaded + chunk.value.byteLength > expected) {
                // Stop a corrupt/mismatched representation before Unity buffers the excess body.
                reader.cancel("Decoded resource exceeds expected length").catch(function () {});
                throw new Error("Decoded resource length mismatch: " + name);
              }
              entry.loaded += chunk.value.byteLength;
              entry.lastByteAt = performance.now();
              controller.enqueue(chunk.value);
            }).catch(function (error) {
              if (entry.phase === "cancelled") return;
              fail(error); controller.error(error);
            });
          },
          cancel: function (reason) {
            entry.done = true; entry.phase = "cancelled";
            return reader.cancel(reason);
          }
        });
        return new Response(counted, {
          status: response.status, statusText: response.statusText, headers: headers
        });
      }, function (error) { fail(error); throw error; });
    };
    return net;
  }
  // 本站章节包的文件名（不是本站或不是包就返回 null）。
  function bundleName(input) {
    var url;
    try { url = new URL(typeof input === "string" ? input : input && input.url, root.location.href); }
    catch (_) { return null; }
    if (url.origin !== root.location.origin || !bundle.test(url.pathname)) return null;
    return url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
  }
  // 页面期望的包内容标记（原始字节 sha256 前 16 位，fingerprint_page.py 注入 LPWebBundleContent）；没有就不核对。
  function contentTag(name) {
    var tags = root.LPWebBundleContent;
    var tag = name && tags && tags[name];
    return typeof tag === "string" && tag ? tag : null;
  }
  // Called from the template preRun callback before chapter requests begin.
  //
  // 浏览器缓存内容标记（2026-10-12 王庭 CRC 事故，WEB_LOAD.md）：Unity 的 UnityCache 以包的 URL 为键、immutable 时
  // 不再校验，而包文件名里的哈希按构建输入算，同名可能不同字节——缓存里的旧字节会一直 CRC 失败、玩家永远进不去。
  // 这里给每个缓存条目的元数据写上 lpContent（页面期望的内容标记）；命中时标记缺失或与页面期望不符就当未命中，
  // loader 会重新下载并覆盖存储。上线后所有老玩家的包都没有标记，会各重新下载一次，这是有意的：它修好同名不同
  // 字节的坏缓存。以后内容变了标记自然不同，不需要再改 CACHE_VERSION。
  function installCacheReader(module) {
    var prototype = module && module.UnityCache && module.UnityCache.prototype;
    if (!prototype || typeof prototype.loadRequest !== "function") return false;
    if (prototype.loadRequest.lpDecodedHeaders) return true;
    var original = prototype.loadRequest;
    var originalUpdate = prototype.updateRequestMetaData;
    var originalStore = prototype.storeRequest;
    // Unity's loader starts storeRequest and updateRequestMetaData in Promise.all.
    // Only tag bytes after Cache.put succeeds; otherwise old bytes could acquire the
    // new tag when the body write fails (quota/I/O) but IndexedDB remains writable.
    var stores = new WeakMap();
    if (typeof originalStore === "function") {
      prototype.storeRequest = function (input) {
        var name = bundleName(input), tag = contentTag(name);
        var result = originalStore.apply(this, arguments);
        if (tag) {
          var requests = stores.get(this);
          if (!requests) { requests = new Map(); stores.set(this, requests); }
          requests.set(name, { promise: result, tag: tag });
        }
        return result;
      };
    }
    if (typeof originalUpdate === "function" && !originalUpdate.lpContentTag) {
      var updateRequestMetaData = function (metaData) {
        var owner = this, args = arguments;
        var name = metaData && bundleName(metaData.url);
        var requests = stores.get(owner), stored = requests && requests.get(name);
        if (!stored) return originalUpdate.apply(owner, args);
        return Promise.resolve(stored.promise).then(function () {
          metaData.lpContent = stored.tag;
          return originalUpdate.apply(owner, args);
        });
      };
      updateRequestMetaData.lpContentTag = true;
      prototype.updateRequestMetaData = updateRequestMetaData;
    }
    function loadRequest(input) {
      var args = arguments, owner = this;
      return original.apply(owner, args).then(function (hit) {
        if (!hit || !hit.response) return hit;
        var name = bundleName(input);
        if (!name) return hit;
        var tag = contentTag(name);
        // 标记缺失或不符：当作未命中（返回 undefined），loader 重新下载、覆盖存储
        if (tag && (!hit.metaData || hit.metaData.lpContent !== tag)) return undefined;
        var expected = (root.LPWebDecodedSizes || {})[name];
        var response = hit.response;
        if (!Number.isSafeInteger(expected) || expected <= 0 || response.status !== 200 ||
            !response.body || response.bodyUsed) return hit;
        if (response.headers.get("Content-Length") === String(expected) &&
            !response.headers.has("Content-Encoding")) return hit;
        var headers = new Headers(response.headers);
        headers.set("Content-Length", String(expected));
        headers.delete("Content-Encoding");
        // Keep the original stream and metadata. No cache rewrite, clone, or full-body buffer.
        hit.response = new Response(response.body, {
          status: response.status, statusText: response.statusText, headers: headers
        });
        return hit;
      });
    }
    loadRequest.lpDecodedHeaders = true;
    prototype.loadRequest = loadRequest;
    return true;
  }
  root.LPWebLoading = { cacheVersion: CACHE_VERSION, cacheControl: cacheControl, installDownloadMeter: installDownloadMeter, installCacheReader: installCacheReader };
})(globalThis);

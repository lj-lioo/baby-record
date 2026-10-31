// 确保测试等到事务提交；可注入写入失败来验证旧缩略图不会被提前清除。
export function fakeIndexedDB({ failWrites = false } = {}) {
  const databases = new Map();
  return {
    databases,
    open(name) {
      const r = {};
      setImmediate(() => {
        const fresh = !databases.has(name);
        if (fresh) databases.set(name, new Map());
        const stores = databases.get(name);
        r.result = {
          objectStoreNames: { contains: (n) => stores.has(n) },
          createObjectStore(n) { stores.set(n, new Map()); },
          transaction(n) {
            const tx = {};
            tx.objectStore = () => ({
              get(key) { const q = {}; setImmediate(() => { q.result = stores.get(n).get(key); q.onsuccess?.(); }); return q; },
              put(value, key) { setImmediate(() => { if (failWrites) { tx.error = new Error('quota'); tx.onabort?.(); } else { stores.get(n).set(key, value); tx.oncomplete?.(); } }); },
              delete(key) { setImmediate(() => { stores.get(n).delete(key); tx.oncomplete?.(); }); },
            });
            return tx;
          },
        };
        if (fresh) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
  };
}

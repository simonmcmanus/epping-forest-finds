// Preloaded with `node --require`: any GitHub lookup reports a draft PR, with no network.
globalThis.fetch = async () => ({ ok: true, json: async () => ({ draft: true }) });

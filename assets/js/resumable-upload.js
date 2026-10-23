/* Bounded, authenticated chunk transport. UI and algorithm are unchanged. */
(() => {
  const CHUNK = 256 * 1024;
  const hex = b => Array.from(new Uint8Array(b), n => n.toString(16).padStart(2, "0")).join("");
  const digest = async b => hex(await crypto.subtle.digest("SHA-256", b));
  const encode = s => new TextEncoder().encode(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const volatile = new Map();
  const memoryStorage = { getItem: k => volatile.get(k) || null,
    setItem: (k, v) => volatile.set(k, v), removeItem: k => volatile.delete(k) };

  async function upload(file, options) {
    const { api, key, onProgress = () => {} } = options;
    const maxBytes = options.maxBytes || 256 * 1024 ** 2;
    if (!file.size || file.size > maxBytes || !/\.zip$/i.test(file.name)) throw new Error("Choose a valid recording ZIP.");
    let store = options.storage;
    if (!store) { try { store = localStorage; } catch { store = memoryStorage; } }
    const fetcher = options.fetcher || fetch;
    const started = Date.now(), deadline = started + (options.budgetMs || 1800000);
    const scope = await digest(encode("mild-resume-v1:" + api + ":" + key));
    const hashes = [];
    // WebCrypto digest is not streaming: use bounded file slices, never a
    // 256MiB whole-file allocation or a stored copy of the user's recording.
    for (let i = 0; i < file.size; i += CHUNK) hashes.push(await digest(await file.slice(i, i + CHUNK).arrayBuffer()));
    const metadata = { size: file.size, chunk_size: CHUNK, chunk_hashes: hashes,
      filename: file.name.slice(0, 160), sensor_route: "insta360_x5", tag_size_m: options.tagSize, consent: true };
    const fp = await digest(encode(JSON.stringify([metadata.size, CHUNK, hashes, metadata.filename, metadata.sensor_route, metadata.tag_size_m])));
    const storageKey = "mildUploadResumeV1:" + scope + ":" + fp;
    let saved;
    try { saved = JSON.parse(store.getItem(storageKey) || memoryStorage.getItem(storageKey) || "null"); } catch {}
    if (!saved || saved.fingerprint !== fp || !Number.isFinite(saved.expires_at) || saved.expires_at <= Date.now() || !/^[a-f0-9]{32}$/.test(saved.client_id || "")) {
      saved = { fingerprint: fp, client_id: hex(crypto.getRandomValues(new Uint8Array(16))), expires_at: Date.now() + 86400000 };
    }
    const persist = () => {
      memoryStorage.setItem(storageKey, JSON.stringify(saved));
      try { store.setItem(storageKey, JSON.stringify(saved)); } catch { store = memoryStorage; }
    };
    persist(); // Persist BEFORE first request so a lost creation response is safe.
    metadata.client_id = saved.client_id;
    let lastRequest = 0;
    async function request(route, method = "GET", body, type) {
      let lastError;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (Date.now() >= deadline) throw new Error("The upload timed out. Check your connection and choose the ZIP again.");
        await sleep(Math.max(0, (options.paceMs ?? 650) - (Date.now() - lastRequest)));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(options.requestTimeoutMs || 45000, deadline - Date.now()));
        let retryAfter = 0;
        try {
          lastRequest = Date.now();
          const response = await fetcher(api + route, { method, body, credentials: "omit", signal: controller.signal,
            headers: { Authorization: "Bearer " + key, ...(type ? { "Content-Type": type } : {}) } });
          const value = await response.json().catch(() => ({}));
          if (response.ok) return value;
          const error = new Error(typeof value.detail === "string" ? value.detail : "Upload could not complete. Choose the file to try again.");
          error.status = response.status;
          if (response.status === 410) { saved.expires_at = 0; persist(); }
          retryAfter = Math.min(60, Number(response.headers.get("Retry-After")) || 0) * 1000;
          if (![408, 429, 500, 502, 503, 504].includes(response.status)) throw error;
          lastError = error;
        } catch (error) {
          if (error.status && ![408, 429, 500, 502, 503, 504].includes(error.status)) throw error;
          lastError = error;
        } finally { clearTimeout(timer); }
        if (attempt < 4) await sleep(Math.min(deadline - Date.now(), Math.max(retryAfter, (options.retryBaseMs ?? 1000) * 2 ** attempt)));
      }
      throw new Error(lastError?.status ? lastError.message : "The upload connection was interrupted. Choose the ZIP again to retry.");
    }
    let session = await request("/api/uploads", "POST", JSON.stringify(metadata), "application/json");
    if (!/^[a-f0-9]{32}$/.test(session.upload_id || "") || session.chunk_size !== CHUNK) throw new Error("The service returned an invalid upload session.");
    saved.upload_id = session.upload_id; saved.expires_at = Date.parse(session.expires_at); persist();
    const received = new Set(session.received || []);
    let bytes = [...received].reduce((n, i) => n + Math.min(CHUNK, file.size - i * CHUNK), 0);
    onProgress(Math.min(100, Math.round(bytes / file.size * 100)));
    for (let i = 0; i < hashes.length && session.status !== "complete"; i++) {
      if (received.has(i)) continue;
      const part = file.slice(i * CHUNK, Math.min(file.size, (i + 1) * CHUNK));
      await request(`/api/uploads/${session.upload_id}/chunks/${i}`, "PUT", part, "application/octet-stream");
      bytes += part.size; onProgress(Math.min(100, Math.round(bytes / file.size * 100)));
    }
    if (session.status !== "complete") session = await request(`/api/uploads/${session.upload_id}/complete`, "POST");
    if (session.status !== "complete" || !session.job?.job_id) throw new Error("The service did not return a recording ID. Please try again.");
    onProgress(100);
    return { job: session.job, acknowledge() {
      // Called only AFTER the existing page stores the returned job link.
      try {
        const current = JSON.parse(store.getItem(storageKey) || "null");
        if (current?.client_id === saved.client_id) store.removeItem(storageKey);
        memoryStorage.removeItem(storageKey);
      } catch {}
    } };
  }
  window.MildResumableUpload = Object.freeze({ upload, chunkBytes: CHUNK });
})();

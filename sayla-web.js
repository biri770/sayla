// Saýla web-saýty: brauzer bilen işleýän kömekçiler (Kotlin/Wasm koddan çagyrylýar).
// Hemme maglumat diňe şu telefonyň brauzer ammarynda (IndexedDB) saklanýar.
(function () {
  "use strict";

  // ---------- IndexedDB ammary ----------
  const DB_NAME = "sayla";
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function () {
          const db = req.result;
          if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
          if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }
    return dbPromise;
  }

  function tx(store, mode, work) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(store, mode);
        const result = work(t.objectStore(store));
        t.oncomplete = function () { resolve(result && "result" in result ? result.result : undefined); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function bytesToBase64(bytes) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function blobToBase64(blob) {
    return blob.arrayBuffer().then(function (buf) { return bytesToBase64(new Uint8Array(buf)); });
  }

  // Ammar köne bolanda brauzer ony pozmasyn diýip haýyş edýär
  function requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }
  }

  // ---------- Ses: market skaneri ýaly "biip" ----------
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(function () {});
    return audioCtx;
  }
  // iPhone sesi diňe ulanyjy basandan soň açýar
  ["touchstart", "pointerdown", "keydown"].forEach(function (ev) {
    window.addEventListener(ev, function unlock() { ensureAudio(); }, { passive: true });
  });

  function beep(freq, ms) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const dur = ms / 1000;
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.9, now + dur * 0.08);
    gain.gain.setValueAtTime(0.9, now + dur * 0.92);
    gain.gain.linearRampToValueAtTime(0, now + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  // ---------- Surat saýlamak (galereýa / kamera) ----------
  // Surat dik ýagdaýa getirilýär we iň uzyn tarapy 2048 piksele çenli kiçeldilýär
  function downscaleToJpegBase64(file, maxSide) {
    return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () {
      return createImageBitmap(file);
    }).then(function (bitmap) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
      if (bitmap.close) bitmap.close();
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error("JPEG döredilmedi")); return; }
          blobToBase64(blob).then(resolve, reject);
        }, "image/jpeg", 0.85);
      });
    });
  }

  function pickFile(accept, capture, onLoaded, onError, asImage) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    if (capture) input.setAttribute("capture", "environment");
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      const work = asImage ? downscaleToJpegBase64(file, 2048) : file.arrayBuffer().then(function (b) { return bytesToBase64(new Uint8Array(b)); });
      work.then(function (b64) { onLoaded(b64); }, function (e) { onError(String(e && e.message || e)); });
    });
    input.click();
  }

  // ---------- Paýlaşmak ----------
  function shareText(text) {
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () { alert("Tekst göçürildi"); });
    }
  }

  function shareFile(b64, fileName, mime) {
    const blob = new Blob([base64ToBytes(b64)], { type: mime });
    const file = new File([blob], fileName, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: fileName }).catch(function (e) {
        if (e && e.name !== "AbortError") download(blob, fileName);
      });
    } else {
      download(blob, fileName);
    }
  }

  function download(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  // ---------- Shtrih-kod skaneri (ZXing) ----------
  // Kamera Compose ekranynyň üstünde aýratyn HTML gatlakda görkezilýär
  let scanner = null;
  // Kompozable "gizle" diýen bolsa (meselem netije kartoçkasy görkezilýär), ýeri täzelenende
  // kamera ýene görünmesin
  let scannerVisible = true;

  function scannerShow(x, y, w, h, onCode) {
    if (!scanner) {
      const box = document.createElement("div");
      box.id = "sayla-scanner";
      box.style.cssText = "position:fixed;overflow:hidden;z-index:10;background:#000;";
      const video = document.createElement("video");
      video.setAttribute("playsinline", "");
      video.muted = true;
      video.autoplay = true;
      video.style.cssText = "width:100%;height:100%;object-fit:cover;";
      const reticle = document.createElement("div");
      reticle.style.cssText = "position:absolute;left:10%;width:80%;height:140px;top:50%;transform:translateY(-50%);" +
        "border:3px solid #fff;border-radius:16px;box-sizing:border-box;pointer-events:none;";
      // Kamera açylmasa sebäbi şu ýerde ýazylýar (ekrany saklaýan alert ýok)
      const message = document.createElement("div");
      message.style.cssText = "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
        "padding:24px;text-align:center;color:#fff;font:15px/1.4 -apple-system,Roboto,sans-serif;background:#000;";
      box.appendChild(video);
      box.appendChild(reticle);
      box.appendChild(message);
      document.body.appendChild(box);
      // Has berk gözleg (TRY_HARDER) + diňe biziň ulanýan kod görnüşlerimiz: kargo belliklerindäki
      // inçe Code128 kodlary hem okalsyn
      const F = ZXing.BarcodeFormat;
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E,
        F.ITF, F.CODABAR, F.QR_CODE, F.DATA_MATRIX, F.PDF_417,
      ]);
      const reader = new ZXing.MultiFormatReader();
      reader.setHints(hints);
      const canvas = document.createElement("canvas");
      scanner = {
        box: box, video: video, message: message, reader: reader, onCode: onCode,
        canvas: canvas, ctx: canvas.getContext("2d", { willReadFrequently: true }),
        started: false, stream: null, timer: null,
      };
    }
    scanner.onCode = onCode;
    scannerMove(x, y, w, h);
    scanner.box.style.display = scannerVisible ? "block" : "none";
    if (!scanner.started) startDecoding();
  }

  // Kamerany özümiz açýarys we kadrlary özümiz okaýarys (ZXing-iň öz dowamly okaýşy iPhone-da
  // wideo ölçegi belli bolmanka 0x0 kanwas döredip, hiç zat tapmaýar)
  function startDecoding() {
    if (!scanner) return;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showScannerMessage("Kamera diňe howpsuz (https) salgyda işleýär. Synag salgysynda kamera ýok — hakyky saýtda işlär.");
      return;
    }
    scanner.message.style.display = "none";
    scanner.started = true;
    const s = scanner;
    navigator.mediaDevices.getUserMedia({
      audio: false,
      // iPhone başda 640x480 berýär: inçe çyzyklar üçin has ýokary çözgüt soraýarys
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    }).then(function (stream) {
      if (scanner !== s || !s.started) { stopStream(stream); return; }
      s.stream = stream;
      s.video.srcObject = stream;
      s.video.play().catch(function () {});
      if (!s.timer) s.timer = setInterval(scanFrame, 150);
    }).catch(function (e) {
      if (scanner !== s) return;
      s.started = false;
      if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
        showScannerMessage("Kamera rugsady berilmedi. iPhone-da: Sazlamalar → Safari → Kamera → «Sora» ýa-da «Rugsat ber».");
      } else {
        showScannerMessage("Kamera açylmady: " + (e && e.message || e));
      }
    });
  }

  function stopStream(stream) {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
  }

  function stopDecoding() {
    if (!scanner) return;
    if (scanner.timer) { clearInterval(scanner.timer); scanner.timer = null; }
    stopStream(scanner.stream);
    scanner.stream = null;
    scanner.video.srcObject = null;
    scanner.started = false;
  }

  // Bir kadr: wideonyň ortasyndaky zolak (ramka düşýän ýer) kesilip okalýar
  function scanFrame() {
    const s = scanner;
    if (!s || !s.stream || s.box.style.display === "none") return;
    const v = s.video;
    if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;
    const vw = v.videoWidth, vh = v.videoHeight;
    const sw = Math.round(vw * 0.9), sh = Math.round(vh * 0.5);
    const sx = (vw - sw) >> 1, sy = (vh - sh) >> 1;
    const scale = Math.min(1, 1100 / sw);
    const cw = Math.max(1, Math.round(sw * scale)), ch = Math.max(1, Math.round(sh * scale));
    if (s.canvas.width !== cw) s.canvas.width = cw;
    if (s.canvas.height !== ch) s.canvas.height = ch;
    s.ctx.drawImage(v, sx, sy, sw, sh, 0, 0, cw, ch);
    const text = decodeCanvas(s, ZXing.HybridBinarizer) || decodeCanvas(s, ZXing.GlobalHistogramBinarizer);
    if (text && scanner === s && s.onCode) s.onCode(text);
  }

  function decodeCanvas(s, Binarizer) {
    try {
      const source = new ZXing.HTMLCanvasElementLuminanceSource(s.canvas);
      const bitmap = new ZXing.BinaryBitmap(new Binarizer(source));
      const result = s.reader.decodeWithState(bitmap);
      return result ? result.getText() : null;
    } catch (e) {
      return null; // kod tapylmady — indiki kadr
    } finally {
      try { s.reader.reset(); } catch (e) {}
    }
  }

  function streamIsLive() {
    const stream = scanner && scanner.stream;
    return !!stream && stream.getVideoTracks().some(function (t) { return t.readyState === "live"; });
  }

  // iPhone programma fona geçende kamerany öçürýär; görnende täzeden açýarys (ýogsam gara ekran)
  function resumeCamera() {
    if (!scanner || scanner.box.style.display === "none" || !scanner.started) return;
    if (streamIsLive()) {
      scanner.video.play().catch(function () {});
    } else if (scanner.stream) {
      stopDecoding();
      startDecoding();
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) resumeCamera();
  });
  window.addEventListener("pageshow", resumeCamera);

  function showScannerMessage(text) {
    if (!scanner) return;
    scanner.message.textContent = text;
    scanner.message.style.display = "flex";
  }

  // Compose pikselde berýär (#sayla-app-yň içinde), sahypa CSS pikselde garaşýar
  function scannerMove(x, y, w, h) {
    if (!scanner) return;
    const host = document.getElementById("sayla-app");
    const r = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
    const d = window.devicePixelRatio || 1;
    const s = scanner.box.style;
    s.left = (r.left + x / d) + "px";
    s.top = (r.top + y / d) + "px";
    s.width = (w / d) + "px";
    s.height = (h / d) + "px";
  }

  function scannerHide() {
    scannerVisible = true;
    if (!scanner) return;
    stopDecoding();
    scanner.box.remove();
    scanner = null;
  }

  function scannerSetVisible(visible) {
    scannerVisible = visible;
    if (!scanner) return;
    scanner.box.style.display = visible ? "block" : "none";
    // Gizlenen wideo iPhone-da togtaýar: görnende ýene oýnat (ýa-da kamerany täzeden aç)
    if (visible) resumeCamera();
  }

  window.SaylaWeb = {
    // ammar
    getText: function (key) { return tx("kv", "readonly", function (s) { return s.get(key); }).then(function (v) { return v == null ? null : String(v); }); },
    putText: function (key, value) { return tx("kv", "readwrite", function (s) { s.put(value, key); }).then(function () { return true; }); },
    getImage: function (name) {
      return tx("images", "readonly", function (s) { return s.get(name); }).then(function (blob) { return blob ? blobToBase64(blob) : null; });
    },
    putImage: function (name, b64) {
      const blob = new Blob([base64ToBytes(b64)], { type: "image/jpeg" });
      return tx("images", "readwrite", function (s) { s.put(blob, name); }).then(function () { return true; });
    },
    imageNames: function () {
      return tx("images", "readonly", function (s) { return s.getAllKeys(); }).then(function (keys) { return JSON.stringify(keys || []); });
    },
    clearImages: function () { return tx("images", "readwrite", function (s) { s.clear(); }).then(function () { return true; }); },
    requestPersistence: requestPersistence,
    // beýlekiler
    beep: beep,
    pickImage: function (camera, onLoaded, onError) { pickFile("image/*", camera, onLoaded, onError, true); },
    pickBackup: function (onLoaded, onError) { pickFile(".zip,application/zip,application/octet-stream", false, onLoaded, onError, false); },
    shareText: shareText,
    shareFile: shareFile,
    // iPhone "Вставить" düwmesini görkezýär; ulanyjy basanda tekst gelýär
    readClipboard: function (onText) {
      if (!navigator.clipboard || !navigator.clipboard.readText) { onText(""); return; }
      navigator.clipboard.readText().then(function (t) { onText(t || ""); }, function () { onText(""); });
    },
    scannerShow: scannerShow,
    scannerMove: scannerMove,
    scannerHide: scannerHide,
    scannerSetVisible: scannerSetVisible,
  };
})();

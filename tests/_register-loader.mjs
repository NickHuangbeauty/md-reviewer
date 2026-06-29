// 以 --import 預先載入：設定模擬的 Vite env，並註冊改寫 import.meta.env 的載入器。
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// 模擬 Vite 編譯期 env（測試預設為非 canary、無自訂遠端旗標 URL，行為與正式版預設一致）。
globalThis.__VITE_ENV__ = { VITE_CANARY: '', VITE_REMOTE_FLAGS_URL: undefined };

register(new URL('./_vite-env-loader.mjs', import.meta.url));

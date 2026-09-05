import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {zipSync,strToU8} from "fflate";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
// Deliberate allowlist: never walk the project recursively.
export const SHARE_FILES=["README.md","操作指南.md","給Agent的使用說明.md","skills/unifi-line-kit-assistant/SKILL.md","skills/unifi-line-kit-assistant/workflow.md","skills/unifi-line-kit-assistant/troubleshooting.md","LICENSE","package.json","package-lock.json",".gitignore","wrangler.example.json",
  "src/worker.mjs","scripts/config.mjs","scripts/cli.mjs","scripts/guidance.mjs","scripts/share.mjs","tests/kit.test.mjs","tests/guidance.test.mjs",
  "scripts/store.mjs","scripts/operations.mjs","scripts/ui-server.mjs","scripts/ui.mjs","ui/index.html","ui/style.css","ui/app.js","tests/ui.test.mjs","Start.command","Start.cmd"];
const entries={};
for(const file of SHARE_FILES) {
  const bytes=new Uint8Array(await readFile(resolve(root,file)));
  entries["unifi-line-kit/"+file]=file==='Start.command'?[bytes,{os:3,attrs:0o100755<<16}]:bytes;
}
entries["unifi-line-kit/SHARE-NOTICE.txt"]=strToU8("此套件不含客戶設定。先安裝 Node.js 22+；Mac 雙擊 Start.command，Windows 雙擊 Start.cmd，即可開啟網頁精靈。也可執行 npm ci 及 npm run ui。只分享本 ZIP，不要分享已設定的工作資料夾。");
await mkdir(resolve(root,"dist"),{recursive:true});
await writeFile(resolve(root,"dist/unifi-line-kit.zip"),zipSync(entries));
console.log("已產生 dist/unifi-line-kit.zip；白名單打包，不包含 .private、圖片或 node_modules。");

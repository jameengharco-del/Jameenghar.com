import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const html=fs.readFileSync("smart-matching.html","utf8");
const blocks=[...html.matchAll(/<script\\s+type=["']module["'][^>]*>([\\s\\S]*?)<\\/script>/gi)];
if(!blocks.length)throw new Error("No module script found in smart-matching.html");
for(let i=0;i<blocks.length;i++){
 const file=path.join(os.tmpdir(),`jameenghar-smart-matching-${i}.mjs`);
 fs.writeFileSync(file,blocks[i][1]);
 const result=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});
 if(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status||1);}
 fs.unlinkSync(file);
}
console.log(`JavaScript syntax OK (${blocks.length} module script block(s)).`);

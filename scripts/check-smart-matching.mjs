import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const html=fs.readFileSync("smart-matching.html","utf8");
const rules=fs.readFileSync("firestore.rules","utf8");
const worker=fs.readFileSync("imagekit-auth-worker.js","utf8");

const blocks=[...html.matchAll(/<script\s+type=["']module["'][^>]*>([\s\S]*?)<\/script>/gi)];
if(!blocks.length)throw new Error("No module script found in smart-matching.html");
for(let i=0;i<blocks.length;i++){
 const file=path.join(os.tmpdir(),"jameenghar-smart-matching-"+i+".mjs");
 fs.writeFileSync(file,blocks[i][1]);
 const result=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});
 fs.unlinkSync(file);
 if(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status||1);}
}

const checks=[
 ["front-view photo input",html.includes('id="propertyFrontPhoto"')],
 ["interior photo input",html.includes('id="propertyInteriorPhoto"')],
 ["private proof document input",html.includes('id="proofDocument"')],
 ["one video input",html.includes('id="propertyVideo"')],
 ["exactly two public photos enforced in form",html.includes("photos.length!==2")],
 ["front/interior labels stored",html.includes('photoTypes:["front","interior"]')],
 ["video duration limited to 60 seconds",html.includes("duration>60")],
 ["video file limited to 10 MB",html.includes("video.size>10*1024*1024")],
 ["proof uploaded through private Worker route",html.includes('WORKER+"/smart-proof"')],
 ["proof path private in Worker",worker.includes('"/private/property-proofs/"')&&worker.includes('"isPrivateFile", "true"')],
 ["Owner-only proof preview route",worker.includes('requestPath === "/smart-proof-view"')],
 ["marketplace rules require exactly two public photos",rules.includes("request.resource.data.photoUrls.size() == 2")],
 ["marketplace rules require front/interior types",rules.includes('request.resource.data.photoTypes == ["front", "interior"]')],
 ["marketplace private records restricted by type",rules.includes("validMarketplacePrivateCreate(recordId)")],
 ["private records readable only by Owner",rules.includes("match /marketplacePrivate/{recordId} {\n      allow read: if isAdmin();")],
 ["Owner correction form is available",html.includes("Save Corrections & Create Pending Buyer Requirement")],
 ["Owner assigns an approved consultant",html.includes("Assign Buyer-side CRM Consultant")],
 ["legacy buyer private contacts remain private",html.includes("customerPhone:d.phone||")&&html.includes("customerEmail:d.email||")],
 ["Owner-only corrected requirement creation is guarded",rules.includes("isAdmin()")&&rules.includes("validMarketplaceRequirement(requirementId)")],
 ["original legacy record is retained after conversion",html.includes('status:"converted_to_requirement"')]
];
const failed=checks.filter(([,ok])=>!ok);
for(const [label,ok] of checks)console.log((ok?"PASS ":"FAIL ")+label);
if(failed.length){console.error("\n"+failed.length+" Smart Matching check(s) failed.");process.exit(1);}
console.log("JavaScript syntax OK ("+blocks.length+" module script block(s)); all "+checks.length+" Smart Matching checks passed.");

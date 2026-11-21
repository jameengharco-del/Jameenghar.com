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
checks.push(
 ["Owner-only Demo Seller creation control",html.includes('id="createDemoSeller"')],
 ["Synthetic demo front/interior artwork generation",html.includes("demo-front-view.webp")&&html.includes("demo-interior-view.webp")],
 ["Synthetic demo tour video generation",html.includes("createDemoTourVideo")],
 ["Private demo proof upload is confirmed",html.includes("uploadPrivateProof(proofFile)")&&html.includes("proof.isPrivateFile!==true")],
 ["Demo seller remains pending verification",html.includes('status:"pending_verification"')&&html.includes('proofStatus:"pending"')],
 ["Owner demo seller is explicitly marked in Firestore rules",rules.includes("request.resource.data.demoTestOnly == true")&&rules.includes('title.matches("^DEMO ONLY.*")')]
);
checks.push(
 ["private proof upload requests ImageKit isPrivateFile response field",worker.includes('uploadForm.append("responseFields", "isPrivateFile")')],
 ["private proof upload enforces confirmed private flag",worker.includes("imageKitData.isPrivateFile === true")],
 ["Owner can view and respond to its seller-side invitation",html.includes('id="ownerMatchInvitations"')&&html.includes('loadMyMatchInvitations("ownerMatchInvitations")')],
 ["Owner seller response is restricted to seller-side invitations",rules.includes('(isAdmin() && request.resource.data.side == "seller")')&&rules.includes('resource.data.toUid == request.auth.uid')],
 ["Smart Matching offers a visible logout button",html.includes('id="smartLogout"')&&html.includes("signOut(auth)")&&html.includes("import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut}") ],
 ["Owner Managed Deal Tracking section is present",html.includes('id="managedDealsQueue"')&&html.includes('id="refreshManagedDeals"')],
 ["Managed deal stages include site visit, negotiation, token, agreement and registry",["site_visit_scheduled","negotiation","token_received","agreement_signed","registry_completed"].every(stage=>html.includes('"'+stage+'"'))],
 ["Managed deal updates persist follow-up and Owner notes",html.includes("nextFollowUpDate:followDate")&&html.includes("ownerRemarks:note")&&html.includes("stageHistory:arrayUnion(historyEntry)")],
 ["Managed deal history is displayed",html.includes("Activity History (")&&html.includes("stageHistory")],
 ["Managed deal records remain Owner-only",rules.includes("match /marketplaceDeals/{dealId}")&&rules.includes("allow read, write: if isAdmin();")],
 ["Managed deal Owner-only permission tests exist",fs.readFileSync("scripts/test-smart-matching-rules.mjs","utf8").includes("Approved CRM user cannot read private managed deal records") ]
);
const failed=checks.filter(([,ok])=>!ok);
for(const [label,ok] of checks)console.log((ok?"PASS ":"FAIL ")+label);
if(failed.length){console.error("\n"+failed.length+" Smart Matching check(s) failed.");process.exit(1);}
console.log("JavaScript syntax OK ("+blocks.length+" module script block(s)); all "+checks.length+" Smart Matching checks passed.");

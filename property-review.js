import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
const config={apiKey:"AIzaSyCLqBPwR6LfBHRe-pplNaRvztujCEOy2l8",authDomain:"jameenghar-ffdfd.firebaseapp.com",projectId:"jameenghar-ffdfd",storageBucket:"jameenghar-ffdfd.firebasestorage.app",messagingSenderId:"554797022939",appId:"1:554797022939:web:5abc3fd7e68ea6aeca56fe",measurementId:"G-RQJWG3PBY9"};
const app=getApps().length?getApps()[0]:initializeApp(config);const auth=getAuth(app);const db=getFirestore(app);
const $=id=>document.getElementById(id);
async function loadPropertyApprovals(){
 const root=$("propertyApprovalList"),status=$("propertyApprovalStatus");if(!root||!status)return;root.innerHTML="";status.textContent="Loading pending property submissions…";
 try{const snap=await getDocs(query(collection(db,"properties"),where("isPublished","==",false)));const rows=snap.docs.map(d=>({id:d.id,...d.data()}));
 if(!rows.length){status.textContent="No pending JameenGhar property submissions.";return;}
 status.textContent=rows.length+" unpublished submission(s). Review private files; approve first, then publish separately.";
 rows.forEach(p=>{const box=document.createElement("div");box.className="leadbox";box.style.margin="12px 0";const h=document.createElement("h3");h.textContent=p.title||"Property submission";
 const info=document.createElement("p");info.textContent="Property ID: "+p.id+"\nOwner UID: "+(p.ownerUid||"—")+"\nType: "+(p.propertyType||"—")+" · "+(p.listingPurpose||"—")+"\nLocation: "+(p.locality||"—")+", "+(p.city||"—")+"\nArea: "+(p.areaGaj||"—")+" Gaj · Price: ₹"+Number(p.price||0).toLocaleString("en-IN")+"\nPhotos: "+(p.imageCount||0)+" · Official PDF: "+(p.documentUploaded?"Uploaded":"Missing")+"\nVerification: "+(p.verificationStatus||"pending");
 const note=document.createElement("p");note.className="small";note.textContent="Open the Secure Property Documents & Storage panel and enter this Property ID to inspect private files before approval.";
 const actions=document.createElement("div");actions.style.cssText="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px";
 const approve=document.createElement("button");approve.className="secondary";approve.type="button";approve.textContent="Approve after document check";approve.disabled=!(p.status==="pending"&&p.imageCount>=4&&p.documentUploaded===true);
 approve.onclick=async()=>{if(!confirm("Have you personally checked the official PDF and all four distinct photos?"))return;approve.disabled=true;try{await updateDoc(doc(db,"properties",p.id),{status:"approved",verificationStatus:"approved",documentsVerified:true,updatedAt:serverTimestamp()});await loadPropertyApprovals()}catch(e){status.textContent="Approval failed: "+e.message;approve.disabled=false}};
 const reject=document.createElement("button");reject.className="reject";reject.type="button";reject.textContent="Reject";reject.disabled=p.status!=="pending";reject.onclick=async()=>{const reason=prompt("Reason for rejection (required):");if(!reason||!reason.trim())return;reject.disabled=true;try{await updateDoc(doc(db,"properties",p.id),{status:"rejected",verificationStatus:"rejected",rejectionReason:reason.trim().slice(0,500),updatedAt:serverTimestamp()});await loadPropertyApprovals()}catch(e){status.textContent="Rejection failed: "+e.message;reject.disabled=false}};
 const publish=document.createElement("button");publish.className="primary";publish.type="button";publish.textContent="Publish";publish.disabled=!(p.status==="approved"&&p.documentsVerified===true&&p.imageCount>=4&&p.documentUploaded===true);publish.onclick=async()=>{if(!confirm("Publish this verified property on JameenGhar.com?"))return;publish.disabled=true;try{await updateDoc(doc(db,"properties",p.id),{status:"approved",isPublished:true,addressVisibility:"public",updatedAt:serverTimestamp()});await loadPropertyApprovals()}catch(e){status.textContent="Publish failed: "+e.message;publish.disabled=false}};
 actions.append(approve,reject,publish);box.append(h,info,note,actions);root.appendChild(box);});
 }catch(e){status.textContent="Could not load property submissions: "+e.message}
}
$("refreshPropertyApprovals")?.addEventListener("click",loadPropertyApprovals);
auth.onAuthStateChanged(user=>{if(user&&user.uid==="P46WrdzpVWVHVC4t6vqIOYcZfxC3")loadPropertyApprovals()});
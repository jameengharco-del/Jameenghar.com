import fs from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const rules = fs.readFileSync("firestore.rules", "utf8");
const env = await initializeTestEnvironment({
  projectId: "demo-jameenghar",
  firestore: { host: "127.0.0.1", port: 8080, rules }
});
const ownerUid = "P46WrdzpVWVHVC4t6vqIOYcZfxC3";
const crmUid = "crm_access_test";
const otherUid = "crm_access_other";
const crm = env.authenticatedContext(crmUid, { email: "crm-access@example.com", email_verified: true }).firestore();
const other = env.authenticatedContext(otherUid, { email: "crm-other@example.com", email_verified: true }).firestore();
const owner = env.authenticatedContext(ownerUid, { email: "jameenghar.co@gmail.com", email_verified: true }).firestore();
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("PASS " + name); }

const lead = (assignedTo, createdBy) => ({
  customerName: "Test Buyer", phone: "9876543210", email: "buyer@example.com",
  enquiryType: "buyer", propertyLocation: "Jaipur", budget: "1 Cr",
  message: "Test enquiry", source: "crm", status: "new",
  assignedTo, assignedAgentName: assignedTo === "unassigned" ? "Unassigned" : "Test Consultant",
  followUpDate: "", remarks: "", createdBy, createdByName: "Test Consultant",
  createdAt: new Date(), updatedAt: new Date()
});
const proof = (overrides = {}) => ({
  recordType: "seller_property", recordId: "proof_case",
  createdBy: crmUid, createdByName: "Test Consultant",
  contactEmail: "crm-access@example.com", mapPin: "Jaipur map pin",
  proofFileId: "proof-file", proofFilePath: "/private/property-proofs/proof.jpg",
  proofFileSize: 1024, proofMimeType: "image/jpeg", proofStatus: "pending",
  createdAt: serverTimestamp(), ...overrides
});
try {
  await env.withSecurityRulesDisabled(async (context) => {\n    const db = context.firestore();
    await setDoc(doc(db, "users", crmUid), { uid: crmUid, email: "crm-access@example.com", role: "crm", status: "approved", emailVerificationRequired: true });
    await setDoc(doc(db, "users", otherUid), { uid: otherUid, email: "crm-other@example.com", role: "crm", status: "approved", emailVerificationRequired: true });
    await setDoc(doc(db, "leads", "lead_assigned"), lead(crmUid, crmUid));
    await setDoc(doc(db, "leads", "lead_other"), lead(otherUid, otherUid));
    await setDoc(doc(db, "leads", "lead_unassigned"), lead("unassigned", crmUid));
    await setDoc(doc(db, "leads", "lead_transfer"), lead(crmUid, crmUid));
    await setDoc(doc(db, "leads", "lead_assigned", "activities", "activity_existing"), {
      eventType: "follow-up", actorUid: crmUid, actorName: "Test Consultant",
      summary: "Call completed", status: "contacted", followUpDate: "",
      remarks: "Spoke with buyer", createdAt: new Date()
    });
  });

  await test("consultant can read a lead assigned to them", async () => assertSucceeds(getDoc(doc(crm, "leads", "lead_assigned"))));
  await test("consultant cannot read another consultant's assigned lead", async () => assertFails(getDoc(doc(crm, "leads", "lead_other"))));
  await test("consultant can read their own unassigned lead", async () => assertSucceeds(getDoc(doc(crm, "leads", "lead_unassigned"))));
  await test("another consultant cannot read the first consultant's unassigned lead", async () => assertFails(getDoc(doc(other, "leads", "lead_unassigned"))));

  await test("consultant can update follow-up fields on their lead", async () => {
    await assertSucceeds(updateDoc(doc(crm, "leads", "lead_assigned"), {
      status: "contacted", followUpDate: "2026-11-21", remarks: "Called buyer",
      updatedAt: serverTimestamp(), followUpCompletedDate: "2026-11-20",
      lastFollowUpBy: crmUid
    }));
  });

  await test("consultant cannot reassign a lead", async () => {
    await assertFails(updateDoc(doc(crm, "leads", "lead_transfer"), {
      assignedTo: otherUid, assignedAgentName: "Other Consultant",
      updatedAt: serverTimestamp()
    }));
  });

  await test("Owner can transfer a lead to another consultant", async () => {
    await assertSucceeds(updateDoc(doc(owner, "leads", "lead_transfer"), {
      assignedTo: otherUid, assignedAgentName: "Other Consultant",
      updatedAt: serverTimestamp()
    }));
  });

  await test("previous consultant loses read access after transfer", async () => assertFails(getDoc(doc(crm, "leads", "lead_transfer"))));
  await test("new consultant gains read access after transfer", async () => assertSucceeds(getDoc(doc(other, "leads", "lead_transfer"))));
  await test("Owner retains read access to transferred lead", async () => assertSucceeds(getDoc(doc(owner, "leads", "lead_transfer"))));

  await test("CRM can read activity history for its own lead", async () => assertSucceeds(getDoc(doc(crm, "leads", "lead_assigned", "activities", "activity_existing"))));
  await test("CRM cannot read another consultant's activity history", async () => assertFails(getDoc(doc(crm, "leads", "lead_other", "activities", "activity_existing"))));

  await test("Owner can create a transfer activity record", async () => {
    await assertSucceeds(setDoc(doc(owner, "leads", "lead_transfer", "activities", "owner_transfer_event"), {
      eventType: "transfer", actorUid: ownerUid, actorName: "JameenGhar Owner",
      summary: "Lead transferred to another consultant", status: "new",
      followUpDate: "", remarks: "", createdAt: serverTimestamp(),
      previousAssignedTo: crmUid, previousAssignedAgentName: "Test Consultant",
      newAssignedTo: otherUid, newAssignedAgentName: "Other Consultant"
    }));
  });

  await test("CRM cannot create an Owner-only transfer activity", async () => {
    await assertFails(setDoc(doc(crm, "leads", "lead_assigned", "activities", "crm_transfer_event"), {
      eventType: "transfer", actorUid: crmUid, actorName: "Test Consultant",
      summary: "Unauthorized transfer", status: "new", followUpDate: "",
      remarks: "", createdAt: serverTimestamp(), previousAssignedTo: crmUid,
      newAssignedTo: otherUid
    }));
  });

  await test("private seller proof rejects a non-private storage path", async () => {
    await assertFails(setDoc(doc(crm, "marketplacePrivate", "bad_path"), proof({ proofFilePath: "/public/property-proofs/proof.jpg" })));
  });
  await test("private seller proof rejects files larger than 8 MB", async () => {
    await assertFails(setDoc(doc(crm, "marketplacePrivate", "large_proof"), proof({ proofFileSize: 8 * 1024 * 1024 + 1 })));
  });
  await test("private seller proof rejects unsupported MIME types", async () => {
    await assertFails(setDoc(doc(crm, "marketplacePrivate", "bad_mime"), proof({ proofMimeType: "application/pdf" })));
  });
  await test("private seller proof rejects empty map pins", async () => {
    await assertFails(setDoc(doc(crm, "marketplacePrivate", "empty_pin"), proof({ mapPin: "" })));
  });
  await test("private buyer requirement rejects empty map pins", async () => {
    await assertFails(setDoc(doc(crm, "marketplacePrivate", "requirement_emptyPin"), {
      recordType: "buyer_requirement", recordId: "emptyPin", createdBy: crmUid,
      createdByName: "Test Consultant", contactEmail: "crm-access@example.com",
      mapPin: "", createdAt: serverTimestamp()
    }));
  });
  await test("private buyer requirement rejects unexpected public contact fields", async () => {
    await assertFails(setDoc(doc(crm, "marketplacePrivate", "requirement_extraField"), {
      recordType: "buyer_requirement", recordId: "extraField", createdBy: crmUid,
      createdByName: "Test Consultant", contactEmail: "crm-access@example.com",
      mapPin: "Jaipur", phone: "9876543210", createdAt: serverTimestamp()
    }));
  });
  await test("CRM cannot create private records on behalf of another user", async () => {
    await assertFails(setDoc(doc(crm, "marketplacePrivate", "wrong_creator"), proof({ createdBy: otherUid })));
  });

  console.log("\nAll " + passed + " CRM ownership and private-record tests passed.");
} finally {
  await env.cleanup();
}

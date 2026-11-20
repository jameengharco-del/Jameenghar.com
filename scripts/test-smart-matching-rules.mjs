import fs from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp
} from "firebase/firestore";

const rules = fs.readFileSync("firestore.rules", "utf8");
const env = await initializeTestEnvironment({
  projectId: "demo-jameenghar",
  firestore: { host: "127.0.0.1", port: 8080, rules }
});

const crmUid = "crm_smart_test";
const crm = env.authenticatedContext(crmUid, {
  email: "crm-smart-test@example.com", email_verified: true
}).firestore();
const otherCrm = env.authenticatedContext("crm_smart_other", {
  email: "crm-smart-other@example.com", email_verified: true
}).firestore();
const owner = env.authenticatedContext("P46WrdzpVWVHVC4t6vqIOYcZfxC3", {
  email: "jameenghar.co@gmail.com", email_verified: true
}).firestore();

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("PASS " + name);
}
const privateRef = (id) => doc(crm, "marketplacePrivate", id);
const publicRequirementRef = (id) => doc(crm, "marketplaceRequirements", id);
const publicPropertyRef = (id) => doc(crm, "marketplaceProperties", id);

async function seedProfile() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", crmUid), {
      uid: crmUid, email: "crm-smart-test@example.com",
      role: "crm", status: "approved", emailVerificationRequired: true
    });
    await setDoc(doc(db, "users", "crm_smart_other"), {
      uid: "crm_smart_other", email: "crm-smart-other@example.com",
      role: "crm", status: "approved", emailVerificationRequired: true
    });
  });
}

function buyerPrivate(id, uid = crmUid) {
  return {
    recordType: "buyer_requirement", recordId: id, createdBy: uid,
    createdByName: "Test Consultant", contactEmail: "crm-smart-test@example.com",
    mapPin: "26.9124,75.7873", createdAt: serverTimestamp()
  };
}
function buyerPublic() {
  return {
    title: "Jaipur residential plot", transactionType: "buy",
    propertyType: "residential", city: "Jaipur", locality: "Vaishali Nagar",
    preferredRadiusKm: 5, status: "pending_review",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
}
function sellerPrivate(id, uid = crmUid) {
  return {
    recordType: "seller_property", recordId: id, createdBy: uid,
    createdByName: "Test Consultant", contactEmail: "crm-smart-test@example.com",
    mapPin: "26.9124,75.7873", proofFileId: "proof_" + id,
    proofFilePath: "/private/property-proofs/" + id + ".jpg",
    proofFileSize: 1024, proofMimeType: "image/jpeg",
    proofStatus: "pending", createdAt: serverTimestamp()
  };
}
function sellerPublic(proofId) {
  return {
    title: "Jaipur test property", transactionType: "sale",
    propertyType: "residential", city: "Jaipur", locality: "Malviya Nagar",
    approxArea: "Malviya Nagar, Jaipur", askingPrice: 12500000,
    area: 200, areaUnit: "gaj", facing: "North", roadWidth: "30 ft",
    photoUrls: [
      "https://ik.imagekit.io/jameenghar/front.jpg",
      "https://ik.imagekit.io/jameenghar/interior.jpg"
    ],
    photoTypes: ["front", "interior"], photoCount: 2,
    videoUrl: "https://ik.imagekit.io/jameenghar/tour.mp4",
    videoDurationSeconds: 45, videoFileSize: 5 * 1024 * 1024,
    proofStatus: "pending", proofDocumentId: proofId,
    status: "pending_verification",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
}
async function createSellerProof(id, uid = crmUid) {
  await assertSucceeds(setDoc(privateRef(id), sellerPrivate(id, uid)));
}

try {
  await seedProfile();

  await test("CRM can create a valid buyer private requirement", async () => {
    await assertSucceeds(setDoc(privateRef("requirement_reqBuyerA"), buyerPrivate("reqBuyerA")));
  });

  await test("Owner can create a private correction record attributed to an approved consultant", async () => {
    await assertSucceeds(setDoc(doc(owner, "marketplacePrivate", "requirement_legacy_oldLead01"), {
      recordType: "buyer_requirement", recordId: "legacy_oldLead01",
      createdBy: crmUid, createdByName: "Test Consultant",
      contactEmail: "crm-smart-test@example.com", mapPin: "https://maps.google.com/@26.9124,75.7873,16z",
      sourceLeadId: "oldLead01", customerName: "Legacy Buyer",
      customerPhone: "9999999999", customerEmail: "legacy@example.com",
      createdAt: serverTimestamp()
    }));
  });

  await test("Owner can create a corrected pending buyer requirement for the assigned consultant", async () => {
    await assertSucceeds(setDoc(doc(owner, "marketplaceRequirements", "legacy_oldLead01"), {
      title: "Corrected Jaipur buyer requirement", transactionType: "buy",
      propertyType: "Flat / Apartment", city: "Jaipur", locality: "Vaishali Nagar",
      approxArea: "Vaishali Nagar, Jaipur", budgetMin: 5000000, budgetMax: 10000000,
      areaMin: 100, areaMax: 200, areaUnit: "Gaj", preferredRadiusKm: 5,
      facing: "Any", roadWidth: "", additionalRequirements: "",
      status: "pending_review", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }));
  });

  await test("buyer public requirement is rejected without its matching private record", async () => {
    await assertFails(setDoc(publicRequirementRef("reqNoPrivate"), buyerPublic()));
  });

  await test("buyer public requirement is accepted with matching private record", async () => {
    await assertSucceeds(setDoc(publicRequirementRef("reqBuyerA"), buyerPublic()));
  });

  await test("CRM cannot read private buyer map pin", async () => {
    await assertFails(getDoc(privateRef("requirement_reqBuyerA")));
  });

  await test("CRM can create a connect request for an active requirement", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "marketplaceRequirements", "reqActiveForConnect"), {
        title: "Active requirement", city: "Jaipur", locality: "C-Scheme",
        preferredRadiusKm: 5, status: "active"
      });
    });
    await assertSucceeds(setDoc(privateRef("connect_valid"), {
      recordType: "connect_request", requirementId: "reqActiveForConnect",
      createdBy: crmUid, createdByName: "Test Consultant",
      status: "new", createdAt: serverTimestamp()
    }));
  });

  await test("CRM cannot create a connect request for a pending requirement", async () => {
    await assertFails(setDoc(privateRef("connect_pending"), {
      recordType: "connect_request", requirementId: "reqBuyerA",
      createdBy: crmUid, createdByName: "Test Consultant",
      status: "new", createdAt: serverTimestamp()
    }));
  });

  await test("CRM can create a valid private seller proof record", async () => {
    await createSellerProof("property_valid");
  });

  await test("seller public listing is accepted with matching private proof", async () => {
    await assertSucceeds(setDoc(publicPropertyRef("property_valid"), sellerPublic("property_valid")));
  });

  await test("seller public listing is rejected when private proof is missing", async () => {
    await assertFails(setDoc(publicPropertyRef("property_missing_proof"), sellerPublic("missing_proof")));
  });

  await test("seller listing with three public photos is rejected", async () => {
    await createSellerProof("property_three_photos");
    const data = sellerPublic("property_three_photos");
    data.photoUrls.push("https://ik.imagekit.io/jameenghar/extra.jpg");
    data.photoTypes.push("extra");
    data.photoCount = 3;
    await assertFails(setDoc(publicPropertyRef("property_three_photos"), data));
  });

  await test("seller listing with incorrect photo order/types is rejected", async () => {
    await createSellerProof("property_wrong_photo_types");
    const data = sellerPublic("property_wrong_photo_types");
    data.photoTypes = ["interior", "front"];
    await assertFails(setDoc(publicPropertyRef("property_wrong_photo_types"), data));
  });

  await test("seller listing with video longer than 60 seconds is rejected", async () => {
    await createSellerProof("property_long_video");
    const data = sellerPublic("property_long_video");
    data.videoDurationSeconds = 60.1;
    await assertFails(setDoc(publicPropertyRef("property_long_video"), data));
  });

  await test("seller listing with video larger than 10 MB is rejected", async () => {
    await createSellerProof("property_large_video");
    const data = sellerPublic("property_large_video");
    data.videoFileSize = 10 * 1024 * 1024 + 1;
    await assertFails(setDoc(publicPropertyRef("property_large_video"), data));
  });

  await test("seller listing with non-ImageKit media URL is rejected", async () => {
    await createSellerProof("property_external_media");
    const data = sellerPublic("property_external_media");
    data.photoUrls[0] = "https://example.com/front.jpg";
    await assertFails(setDoc(publicPropertyRef("property_external_media"), data));
  });

  await test("CRM cannot update an Owner-only private proof record", async () => {
    await assertFails(updateDoc(privateRef("property_valid"), { proofStatus: "approved" }));
  });

  await test("CRM cannot delete an Owner-only private proof record", async () => {
    await assertFails(deleteDoc(privateRef("property_valid")));
  });

  await test("Owner can read the private seller proof record", async () => {
    await assertSucceeds(getDoc(doc(owner, "marketplacePrivate", "property_valid")));
  });

  console.log("\nAll " + passed + " Smart Matching Firestore rules tests passed.");
} finally {
  await env.cleanup();
}

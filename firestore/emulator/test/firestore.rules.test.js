import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";

const projectId = "demo-jameenghar";
let testEnv;
const adminUid = "P46WrdzpVWVHVC4t6vqIOYcZfxC3";

before(async () => {
  const rules = await readFile(new URL("../../firestore.rules.proposed", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules }
  });
});

after(async () => { await testEnv?.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), path), data);
  });
}
function owner(uid = "owner-1", verified = true, phone = "9876543210") {
  return testEnv.authenticatedContext(uid, {
    email: uid + "@example.test",
    email_verified: verified,
    phone_number: "+91" + phone
  }).firestore();
}
function crm(uid = "crm-1") {
  return testEnv.authenticatedContext(uid, { email: uid + "@example.test", email_verified: true }).firestore();
}
const ownerProfile = uid => ({
  uid, name: "Test Owner", phone: "9876543210", email: uid + "@example.test",
  role: "property_owner", status: "pending", emailVerificationRequired: true
});
const crmProfile = uid => ({
  uid, name: "Test Consultant", phone: "9876543210", email: uid + "@example.test",
  role: "crm", status: "approved"
});

test("verified owner can submit a pending JameenGhar listing with no client-controlled file metadata", async () => {
  await seed("users/owner-1", ownerProfile("owner-1"));
  const db = owner();
  const data = {
    ownerUid: "owner-1", title: "Test Jaipur Plot", propertyType: "Residential Plot",
    listingPurpose: "sale", city: "Jaipur", locality: "Malviya Nagar",
    areaGaj: 150, price: 10000000, facing: "North", description: "Test listing",
    coverImage: "", imageUrls: [], imageCount: 0, documentUploaded: false,
    documentsVerified: false, verificationStatus: "pending", status: "pending",
    addressVisibility: "hidden", isPublished: false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
  await assertSucceeds(setDoc(doc(db, "properties/property-1"), data));
});

test("unverified email and mismatched mobile claim cannot submit a JameenGhar listing", async () => {
  await seed("users/owner-1", ownerProfile("owner-1"));
  const data = {
    ownerUid: "owner-1", title: "Test", propertyType: "Residential Plot",
    listingPurpose: "sale", city: "Jaipur", locality: "Test", areaGaj: 100,
    price: 1000000, facing: "North", description: "", coverImage: "",
    imageUrls: [], imageCount: 0, documentUploaded: false, documentsVerified: false,
    verificationStatus: "pending", status: "pending", addressVisibility: "hidden",
    isPublished: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
  await assertFails(setDoc(doc(owner("owner-1", false), "properties/unverified"), data));
  const wrongPhoneDb = testEnv.authenticatedContext("owner-1", {
    email: "owner-1@example.test", email_verified: true, phone_number: "+919999999999"
  }).firestore();
  await assertFails(setDoc(doc(wrongPhoneDb, "properties/wrong-phone"), data));
});

test("property owner cannot create a listing for another UID or publish it", async () => {
  await seed("users/owner-1", ownerProfile("owner-1"));
  const db = owner();
  const data = {
    ownerUid: "victim", title: "Spoofed", propertyType: "Residential Plot",
    listingPurpose: "sale", city: "Jaipur", locality: "Test", areaGaj: 100,
    price: 1000000, facing: "North", description: "", coverImage: "",
    imageUrls: [], imageCount: 0, documentUploaded: false, documentsVerified: false,
    verificationStatus: "pending", status: "pending", addressVisibility: "hidden",
    isPublished: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
  await assertFails(setDoc(doc(db, "properties/spoof"), data));
  await seed("properties/owned", { ownerUid: "owner-1", status: "pending", isPublished: false });
  await assertFails(setDoc(doc(db, "properties/owned"), { ownerUid: "owner-1", status: "approved", isPublished: true }));
});

test("Daybnb owner can atomically create paired public and private pending records with 9 additional photos", async () => {
  await seed("users/owner-1", ownerProfile("owner-1"));
  const db = owner();
  const batch = writeBatch(db);
  batch.set(doc(db, "daybnbProperties/day-1"), {
    ownerUid: "owner-1", title: "Daybnb Jaipur", propertyType: "Villa", maxGuests: 6,
    city: "Jaipur", locality: "Vaishali Nagar", hourlyRate: 500, dayRate: 2500,
    nightRate: 4000, checkInTime: "14:00", checkOutTime: "11:00",
    coverImage: "pending-cover", imageUrls: Array.from({length: 9}, (_, i) => "pending-" + i),
    amenities: ["WiFi"], description: "Test", status: "pending", isPublished: false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  batch.set(doc(db, "daybnbPrivate/day-1"), {
    propertyId: "day-1", ownerUid: "owner-1", ownerName: "Test Owner",
    ownerPhone: "9876543210", ownerEmail: "owner-1@example.test",
    address: "Private test address", createdAt: serverTimestamp()
  });
  await assertSucceeds(batch.commit());
});

test("Daybnb private owner record cannot be read by another signed-in user", async () => {
  await seed("daybnbPrivate/day-1", { ownerUid: "owner-1", address: "secret" });
  await assertFails(getDoc(doc(crm("crm-1"), "daybnbPrivate/day-1")));
});

test("consultant can read assigned leads and own unassigned leads, but not another consultant's lead", async () => {
  await seed("users/crm-1", crmProfile("crm-1"));
  await seed("users/crm-2", crmProfile("crm-2"));
  await seed("leads/assigned", { assignedTo: "crm-1", createdBy: "crm-2" });
  await seed("leads/created", { assignedTo: "unassigned", createdBy: "crm-1" });
  await seed("leads/other", { assignedTo: "crm-2", createdBy: "crm-2" });
  const db = crm("crm-1");
  await assertSucceeds(getDoc(doc(db, "leads/assigned")));
  await assertSucceeds(getDoc(doc(db, "leads/created")));
  await assertFails(getDoc(doc(db, "leads/other")));
});

test("consultant cannot create a lead with forged creator UID", async () => {
  await seed("users/crm-1", crmProfile("crm-1"));
  const db = crm();
  const data = {
    customerName: "Buyer", phone: "9876543210", email: "", enquiryType: "buyer",
    propertyLocation: "Jaipur", budget: "", message: "Need a plot", source: "crm",
    status: "new", assignedTo: "unassigned", assignedAgentName: "Unassigned",
    followUpDate: "", remarks: "", createdBy: "crm-2", createdByName: "Other",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
  await assertFails(setDoc(doc(db, "leads/forged"), data));
});

test("public guest cannot create a booking against an unpublished listing", async () => {
  await seed("daybnbProperties/not-live", {
    ownerUid: "owner-1", title: "Not Live", status: "pending", isPublished: false, maxGuests: 4
  });
  const db = testEnv.unauthenticatedContext().firestore();
  const booking = {
    propertyId: "not-live", propertyTitle: "Not Live", ownerName: "", ownerPhone: "",
    customerName: "Guest", phone: "9876543210", email: "guest@example.test",
    bookingType: "day", checkInDate: "2026-12-01", checkOutDate: "",
    startTime: "", endTime: "", guests: 2, quotedTotal: 2500, message: "",
    status: "pending", createdAt: serverTimestamp(), currency: "INR",
    paymentAmountPaise: null, paymentStatus: "not_started", paymentProvider: null,
    gatewayOrderId: null, gatewayPaymentId: null, paidAt: null,
    refundStatus: "not_applicable", bookingStage: "awaiting_owner_confirmation",
    paymentAccessTokenHash: "a".repeat(64)
  };
  await assertFails(setDoc(doc(db, "daybnbBookings/booking-1"), booking));
});

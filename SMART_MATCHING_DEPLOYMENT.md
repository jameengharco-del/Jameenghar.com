# JameenGhar Smart Matching — deployment checklist

The production website is GitHub Pages. Do not run Firebase Hosting deployment.

## 1. Cloudflare Worker

Worker: `jameenghar-imagekit-auth`

1. Open Cloudflare Dashboard → Workers & Pages → `jameenghar-imagekit-auth` → Settings → Bindings.
2. Add a **Workers AI** binding with variable name exactly `AI`. Save.
3. Open the Worker's code editor.
4. Replace the Worker source with the complete `imagekit-auth-worker.js` from this branch:
   `https://github.com/jameengharco-del/Jameenghar.com/blob/real-estate-smart-matching-phase1/imagekit-auth-worker.js`
5. Deploy. Keep existing Worker secrets/variables `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_PUBLIC_KEY`, and `FIREBASE_API_KEY`; do not paste secret values into GitHub.

The Worker keeps existing `/property` and `/daybnb` routes. New routes include `/marketplace-media`, `/smart-proof`, `/smart-proof-view`, and `/smart-media-scan`.

## 2. Firestore rules

From Cloud Shell, after checking out the feature branch:

```bash
cd ~/Jameenghar.com
git fetch origin
git checkout real-estate-smart-matching-phase1
git pull origin real-estate-smart-matching-phase1
firebase deploy --only firestore:rules --project jameenghar-ffdfd
```

Do not run `firebase deploy --only hosting`; the site uses GitHub Pages.

## 3. Browser and end-to-end checks

- Open `https://jameenghar.com/smart-matching.html` while signed in through the approved CRM.
- Try a property with 1 photo, a video ≤60 seconds and ≤10 MB, and one proof-document image.
- Verify a photo/video frame with a phone number, URL, social handle or QR contact card is blocked.
- Verify spoken contact details are blocked (requires Workers AI binding `AI`).
- Verify Owner can preview the private proof document; a non-Owner must receive 403.
- Verify the Owner can approve the property; only then should it appear in the shared marketplace.
- Run matching, send an invitation, respond from separate Buyer and Seller CRM accounts, and verify the Owner approval button appears only after both respond Interested.
- Verify both parties receive only sanitized in-app notifications; no private phone/email or exact map pin is exposed.

## Important limitations

OCR/QR and speech-to-text screening reduce the risk of contact details escaping but cannot guarantee detection of every spelling, accent, low-quality frame, hidden code or obfuscated number. Owner review remains mandatory. Audio screening is fail-closed if Workers AI is not configured or transcription fails. The browser checks five sampled video frames; it is not a full-frame forensic scan.

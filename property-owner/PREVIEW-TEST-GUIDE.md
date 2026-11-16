# Safe Local Preview — Property Owner Portal

**File under test:** `property-owner.html`  
**Branch:** `cloudflare-r2-safety`  
**Purpose:** View the page locally without changing the live JameenGhar website.

## Important safety notes

- Do not merge this branch into `main` for this preview.
- Do not change the repository's GitHub Pages source to this branch.
- Do not enter a real user's credentials during a visual preview.
- Registration is intentionally disabled.
- This page does not create or update Firestore records and does not upload property files.
- Login is connected to the existing Firebase project. Use only an approved test account if an actual authentication test is later authorized.

## Step 1 — Download the test page

Open the raw file from the testing branch:

https://raw.githubusercontent.com/jameengharco-del/Jameenghar.com/cloudflare-r2-safety/property-owner.html

Save it on your computer as `property-owner.html`.

Keep `jameenghar-logo.png` in the same folder. Download the logo from:

https://raw.githubusercontent.com/jameengharco-del/Jameenghar.com/cloudflare-r2-safety/jameenghar-logo.png

If the logo is not present on this branch, use the same logo file from the repository's `main` branch.

## Step 2 — Start a local web server (Mac)

1. Put both files in one folder, for example `jameenghar-preview`.
2. Open Terminal.
3. Run:

```bash
cd ~/Downloads/jameenghar-preview
python3 -m http.server 8000
```

4. Keep Terminal open while previewing.

## Step 3 — Open the preview

In your browser, open:

http://localhost:8000/property-owner.html

Check the logo, mobile/desktop layout, Login tab, Create Account tab, and the disabled registration notice.

## Step 4 — Stop the local preview

Return to Terminal and press `Control + C`.

## Authentication testing

A visual preview does not prove Firebase login works. Do not test with the Owner's personal account or a real consultant account. If a dedicated test Property Owner account is created later, first publish and review the Firestore Rules changes in a controlled test environment. Only then test sign-in and profile-role handling.

## Expected result at this stage

- The page loads and shows the JameenGhar brand.
- Login form is visible.
- Create Account tab explains that registration is temporarily disabled.
- No Property Owner account can be registered from this page yet.
- No property submission, document upload, approval, or publication is available.

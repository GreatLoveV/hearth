# Tracker tab watcher for Firefox

This extension reports the active tab's title and address to Tracker on `127.0.0.1:5600`, so the dashboard can show time per website ("youtube.com 2h") instead of just "Firefox". It sends nothing anywhere else. Private windows are recorded as "Private", with no title or address.

## Install

Release versions of Firefox only keep extensions that Mozilla has signed. You have three options:

1. **Try it now (until Firefox restarts):** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and pick `manifest.json` in this folder.
2. **Keep it installed, without signing:** use Firefox Developer Edition or Nightly. Set `xpinstall.signatures.required` to `false` in `about:config`, zip this folder's contents, and install the zip from `about:addons` → gear menu → **Install Add-on From File…**.
3. **Keep it installed in regular Firefox:** sign it yourself as an unlisted add-on. You need a free addons.mozilla.org account. Then run:
   ```bash
   npx web-ext sign --channel=unlisted --api-key=<JWT issuer> --api-secret=<JWT secret>
   ```
   This produces a signed `.xpi` you can install normally. The extension stays private and never appears on the store.

// Shared helper for the @netlify/blobs library.
//
// The v1 (Lambda-compat) Netlify Function handlers we use don't auto-receive
// the Blobs runtime context, which causes MissingBlobsEnvironmentError on
// `getStore('name')`. The fix is to pass siteID + token explicitly.
//
// Required env vars (set in Netlify dashboard):
//   NETLIFY_SITE_ID    — Site configuration → Site information → API ID
//   NETLIFY_AUTH_TOKEN — User settings → Applications → Personal access tokens
//
// If auto-detection works (newer runtimes / v2 handlers), the explicit values
// are ignored — so this is safe to always use.

const { getStore } = require('@netlify/blobs');

function makeStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) {
    return getStore({ name, siteID, token });
  }
  // Fall back to auto-detection (will throw MissingBlobsEnvironmentError if
  // the runtime doesn't inject context).
  return getStore(name);
}

module.exports = { makeStore };

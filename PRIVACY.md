Privacy Policy — Desk Wellness Pack: Smart Stretch
Last updated: March 2026
Overview
Smart Stretch is a Chrome extension that helps desk workers take regular stretch breaks. This privacy policy explains what data the extension accesses, how it is used, and what is never collected or stored.

Data We Access
Google Calendar (Pro feature only)
Users who purchase the Pro version may enable the "Skip during meetings" feature. When enabled, the extension uses the Google Calendar API to check whether the user has a busy slot at the moment a stretch reminder is due.

The extension calls the freeBusy endpoint only
Only a binary busy/free status is checked — no event titles, attendees, descriptions, locations, or any other calendar content is read
No calendar data is transmitted to any server
No calendar data is stored locally or remotely beyond the immediate check

Payment Data
Pro purchases are processed by Stripe. The extension does not collect, process, or store any payment information. All payment data is handled exclusively by Stripe under their own privacy policy.
Local Storage
The extension stores the following data locally on the user's device only:

Stretch timer settings (interval, sound preference)
Weekly stretch activity counts (completed, skipped, snoozed)
Pro license token (a cryptographic hash, not linked to personal identity)
Whether Google Calendar integration is enabled

This data never leaves the user's device and is not transmitted to any server except for license verification (see below).
License Verification
When a user purchases Pro, a license token is generated and stored locally. The extension periodically sends this token along with an anonymous installation ID to our backend to verify the license is valid. No personal information is included in this request.

Data We Do Not Collect

We do not collect names, email addresses, or any personally identifiable information
We do not read, store, or transmit calendar event content of any kind
We do not track browsing activity
We do not use analytics or advertising trackers
We do not sell data to third parties


Third-Party Services
ServicePurposeTheir Privacy PolicyGoogle Calendar APICheck busy/free statushttps://policies.google.com/privacyStripePayment processinghttps://stripe.com/privacyVercelLicense verification backend hostinghttps://vercel.com/legal/privacy-policy

Data Retention
Local extension data is retained until the user uninstalls the extension or clears extension storage. No data is retained on our servers beyond what is necessary for license verification.

User Rights
Users can clear all locally stored extension data at any time by going to chrome://extensions → Smart Stretch → Details → Clear Data.
Users can revoke Google Calendar access at any time by going to myaccount.google.com/permissions and removing Smart Stretch.

Children's Privacy
This extension is not directed at children under 13 and does not knowingly collect data from children.

Changes to This Policy
If this policy changes materially, the Last Updated date above will be revised. Continued use of the extension after changes constitutes acceptance of the updated policy.

Contact
For privacy questions or concerns contact: ioana.el.ionescu@gmail.com

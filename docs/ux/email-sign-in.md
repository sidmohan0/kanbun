# Email-link sign-in

Kanbun uses email sign-in for the invited team pilot. A person needs access to the email their
workspace owner invited; they do not need a password, a Cloudflare account or a separate Kanbun
registration. The configured owner can sign in to initialize the workspace. Other people must
already be active members or have an eligible targeted invitation in the configured domain.
The pilot's domain is `datafog.ai`; knowing or creating an address in that domain does not itself
grant workspace access.

## Request and confirm

1. Open Kanbun or the complete invitation link shared by the owner.
2. Enter the invited email and complete the managed verification if it asks for interaction.
3. Choose **Email me a sign-in link**. The page shows **Check your email** with the same response
   for eligible and ineligible addresses. This message does not confirm membership or delivery.
4. Open the emailed link in the same browser that requested it. If a mail client opens a different
   browser or profile, return to the requesting browser or request a new link in the browser to use.
5. Review the email displayed on **Confirm your sign-in**, then explicitly choose **Sign in as…**.
   Opening or inspecting the link alone never creates a session.
6. A successful confirmation removes the sign-in token from the current fragment and reloads the
   preserved destination. If that destination was an invitation, choose **Accept invitation** to
   join. Sign-in and invitation acceptance are separate steps.

The owner still creates and shares invitation links manually. Creating an invitation does not send
email; requesting a sign-in link does. Email links arrive through Resend from the configured verified
sender. The normal flow never asks the person to register with the infrastructure provider.

The link and resulting session expire one hour after the request. Confirmation does not restart
that hour. Links are single-use and require a browser-bound HttpOnly request cookie. A newer request
replaces that browser's request cookie, so use the most recently requested link. Expired, consumed,
wrong-browser or no-longer-eligible links show recovery guidance without disclosing an account or
opening cached work. **Request a new link** returns to the email form. Network failures provide a
read-only **Check link again** action rather than pretending the link has been consumed.

## Workspace access and session expiry

The public shell asks for current sign-in configuration before starting a workspace client or
opening browser storage. A valid email session allows invitation inspection before admission, but
workspace data still requires an active membership. A signed-in person with no admission sees
**Workspace access required** and instructions to obtain the complete targeted invitation.
Removing access is not undone by signing in again.

An expired native session hides cached workspace rows and description text, closes the live socket,
and shows the email form while preserving the current issue or invitation destination. Existing
pending work stays in its actor/admission-specific browser queue. After sign-in as the same active
identity, a normal reload can resume that queue. Signing in as another person never opens the first
person's queue. A hosted offline cold start does not reopen cached data without fresh authentication;
an already open authorized page can still save offline work locally.

Native sessions show **Sign out** in the sidebar. This saves pending persistence before requesting
session revocation, hides the workspace, closes its socket and reloads the signed-out page. It does
not delete browser queues or claim to sign out another browser's independently issued session.

## Verification and data boundaries

The managed Turnstile widget uses the public configured site key and the `magic_link` action. The
Worker checks the provider response, hostname and action before processing an email request. Used
or failed form submissions renew the verification; expiration clears the old token. A blocked or
failed widget has an explicit retry action. The integration follows Cloudflare's
[SPA rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)
and [server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
contracts. The widget is loaded from its official script URL without copying or proxying it.

Link tokens are fragments in `/#signin/<token>/<encoded-return-hash>` and are posted to same-origin
inspection/consumption endpoints. Allowed return destinations are known application hashes,
including the complete invitation; external URLs, query strings, malformed escapes and nested
sign-in callbacks are rejected. Emails are never query parameters. Session credentials live only
in Secure, HttpOnly, SameSite=Lax, host-only cookies; D1 retains credential hashes. No session bearer
is put in localStorage, application context or a WebSocket URL. Authentication POSTs require JSON
and the configured origin. Public assets and sign-in configuration reveal no workspace rows.

Verify the flow in the actual-runtime browser suite using private test email/verification transports
and normal session cookies. Required proof covers email request, explicit confirmation, invitation
continuation, expired and wrong-browser links, sign-out and account isolation without a production
authentication bypass.
The [hosted rollout](../hosted-preview.md#email-authentication-rollout) separately proves real owner
mail delivery before retiring the legacy outer Access gate.

Forms use existing brand tokens and labelled native controls. Original state transitions are subtle
and disabled for `prefers-reduced-motion`; motion is not required to understand or complete sign-in.

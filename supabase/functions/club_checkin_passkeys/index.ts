import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "npm:@simplewebauthn/server@13.2.2";

const APP_ORIGIN = "https://rhrufc-mini.pages.dev";
const RP_ID = "rhrufc-mini.pages.dev";
const RP_NAME = "Rushden & Higham RUFC Club Check-In";
const corsHeaders = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(v => v.toString(16).padStart(2, "0")).join("");
}

async function audit(db: any, eventType: string, outcome: string, personId: string, installationId: string, details: Record<string, unknown> = {}) {
  const { error } = await db.from("system_admin_audit_log").insert({
    source_system: "club_check_in",
    severity: outcome === "failed" ? "warning" : "info",
    event_type: eventType,
    outcome,
    actor_type: "user",
    actor_reference: personId,
    details: { installation_id: installationId, ...details },
  });
  if (error) console.error("Passkey audit write failed:", error.message);
}

async function validInstallation(db: any, installationId: string) {
  const { data: installation, error } = await db.from("installations")
    .select("person_id")
    .eq("installation_id", installationId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!installation) return false;
  const { data: owner, error: ownerError } = await db.from("approved_users")
    .select("person_id")
    .eq("person_id", installation.person_id)
    .eq("active", true)
    .maybeSingle();
  if (ownerError) throw ownerError;
  return !!owner;
}

async function validUser(db: any, personId: string) {
  const { data, error } = await db.from("approved_users")
    .select("person_id,name,active,protected_user")
    .eq("person_id", personId)
    .maybeSingle();
  if (error) throw error;
  return data && data.active && !data.protected_user ? data : null;
}

async function validSession(db: any, token: string, personId: string, installationId: string) {
  if (typeof token !== "string" || token.length < 32 || token.length > 256) return false;
  const tokenHash = await sha256(token);
  const { data, error } = await db.from("user_auth_sessions")
    .select("id")
    .eq("person_id", personId)
    .eq("installation_id", installationId)
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function saveChallenge(db: any, personId: string, installationId: string, operation: string, challenge: string) {
  await db.from("club_checkin_webauthn_challenges").delete()
    .eq("person_id", personId).eq("installation_id", installationId).eq("operation", operation);
  const { error } = await db.from("club_checkin_webauthn_challenges").insert({
    person_id: personId,
    installation_id: installationId,
    operation,
    challenge,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
  if (error) throw error;
}

async function takeChallenge(db: any, personId: string, installationId: string, operation: string) {
  const { data, error } = await db.from("club_checkin_webauthn_challenges")
    .delete()
    .eq("person_id", personId)
    .eq("installation_id", installationId)
    .eq("operation", operation)
    .gt("expires_at", new Date().toISOString())
    .select("challenge")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.challenge || null;
}

async function createSession(db: any, personId: string, installationId: string, userName: string) {
  const { data: roles, error: roleError } = await db.from("user_role_assignments")
    .select("role_key").eq("person_id", personId);
  if (roleError) throw roleError;
  const roleKeys = [...new Set((roles || []).map((r: any) => r.role_key))].sort();
  if (!roleKeys.length) throw new Error("No access role assigned");

  const { data: groups, error: groupError } = await db.from("user_age_group_assignments")
    .select("age_group_id").eq("person_id", personId);
  if (groupError) throw groupError;

  const token = randomToken();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const { error: sessionError } = await db.from("user_auth_sessions").insert({
    person_id: personId,
    installation_id: installationId,
    token_hash: await sha256(token),
    expires_at: expiresAt,
  });
  if (sessionError) throw sessionError;

  await db.from("installations").update({ last_seen_at: new Date().toISOString() })
    .eq("installation_id", installationId);

  return {
    success: true,
    person_id: personId,
    name: userName,
    roles: roleKeys,
    age_group_ids: (groups || []).map((g: any) => g.age_group_id),
    session_token: token,
    session_expires_at: expiresAt,
  };
}

async function recordPasskeyFailure(db: any, installationId: string, personId: string, reason: string) {
  await db.from("user_pin_login_attempts").upsert(
    { installation_id: installationId, failed_attempts: 0, updated_at: new Date().toISOString() },
    { onConflict: "installation_id", ignoreDuplicates: true },
  );
  const { data } = await db.from("user_pin_login_attempts")
    .select("failed_attempts,locked_until").eq("installation_id", installationId).maybeSingle();
  if (data?.locked_until && new Date(data.locked_until).getTime() > Date.now()) return;
  const previousAttempts = data?.locked_until && new Date(data.locked_until).getTime() <= Date.now()
    ? 0
    : (data?.failed_attempts || 0);
  const next = previousAttempts + 1;
  await db.from("user_pin_login_attempts").update({
    failed_attempts: next,
    locked_until: next >= 5 ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("installation_id", installationId);
  await audit(db, "passkey_login", "failed", personId, installationId, { reason });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ success: false, message: "Method not allowed." }, 405);
  if (req.headers.get("origin") !== APP_ORIGIN) return reply({ success: false, message: "Origin not allowed." }, 403);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return reply({ success: false, message: "Service unavailable." }, 500);
    const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const body = await req.json();
    const action = body?.action;
    let personId = String(body?.person_id || "");
    const installationId = String(body?.installation_id || "");

    if (!/^INSTALL-[A-Za-z0-9-]{20,80}$/.test(installationId)) {
      return reply({ success: false, message: "Invalid installation." }, 400);
    }

    let user: any = null;
    let installationIsValid = false;

    if (action === "authentication-options-by-name") {
      const [loginResult, installationResult] = await Promise.all([
        db.rpc("get_personal_pin_login_status", { supplied_name: String(body?.supplied_name || "") }),
        validInstallation(db, installationId),
      ]);
      const { data: login, error: loginError } = loginResult;
      if (loginError) throw loginError;
      if (!login?.success) {
        return reply({ success: false, message: login?.message || "Name not recognised." }, 404);
      }
      if (!installationResult) {
        return reply({ success: false, message: "Account or installation is not authorised." }, 403);
      }
      personId = String(login.person_id || "");
      if (!/^[A-Za-z0-9_-]{2,80}$/.test(personId)) {
        return reply({ success: false, message: "Invalid account." }, 400);
      }
      if (login.protected_user || login.pin_setup_required) {
        return reply({
          success: true,
          person_id: personId,
          display_name: login.display_name,
          pin_setup_required: login.pin_setup_required === true,
          protected_user: login.protected_user === true,
          options: null
        });
      }
      user = { name: login.display_name };
      installationIsValid = installationResult;
    } else {
      if (!/^[A-Za-z0-9_-]{2,80}$/.test(personId)) {
        return reply({ success: false, message: "Invalid account." }, 400);
      }
      const [userResult, installationResult] = await Promise.all([
        validUser(db, personId),
        validInstallation(db, installationId),
      ]);
      user = userResult;
      installationIsValid = installationResult;
    }

    if (!user || !installationIsValid) {
      return reply({ success: false, message: "Account or installation is not authorised." }, 403);
    }

    if (action === "status") {
      const { data, error } = await db.from("club_checkin_passkeys")
        .select("id").eq("person_id", personId).eq("installation_id", installationId).eq("active", true).maybeSingle();
      if (error) throw error;
      return reply({ success: true, available: !!data });
    }

    if (action === "authentication-options" || action === "authentication-options-by-name") {
      // Lockout, installation access and credential lookup do not depend on one another.
      const [attemptsResult, accessResult, credentialsResult] = await Promise.all([
        db.from("user_pin_login_attempts")
          .select("locked_until").eq("installation_id", installationId).maybeSingle(),
        db.from("installation_user_access")
          .select("active").eq("person_id", personId).eq("installation_id", installationId).eq("active", true).maybeSingle(),
        db.from("club_checkin_passkeys")
          .select("credential_id,transports").eq("person_id", personId)
          .eq("installation_id", installationId).eq("active", true),
      ]);
      const { data: attempts, error: attemptsError } = attemptsResult;
      const { data: access, error: accessError } = accessResult;
      const { data: credentials, error } = credentialsResult;
      if (attemptsError) throw attemptsError;
      if (accessError) throw accessError;
      if (error) throw error;
      if (attempts?.locked_until && new Date(attempts.locked_until).getTime() > Date.now()) {
        return reply({ success: false, message: "Login temporarily locked. Please try again later." }, 429);
      }
      if (!access) return reply({ success: false, message: "PIN sign-in is required first on this installation." }, 403);
      if (!credentials?.length) {
        return reply({
          success: true,
          available: false,
          person_id: personId,
          display_name: user.name,
          pin_setup_required: false,
          protected_user: false,
        });
      }
      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        allowCredentials: credentials.map((c: any) => ({ id: c.credential_id, transports: c.transports })),
        userVerification: "required",
        timeout: 60000,
      });
      await saveChallenge(db, personId, installationId, "authentication", options.challenge);
      return reply({
        success: true,
        available: true,
        person_id: personId,
        display_name: user.name,
        pin_setup_required: false,
        protected_user: false,
        options
      });
    }

    if (action === "authentication-verify") {
      const { data: attempts, error: attemptsError } = await db.from("user_pin_login_attempts")
        .select("locked_until").eq("installation_id", installationId).maybeSingle();
      if (attemptsError) throw attemptsError;
      if (attempts?.locked_until && new Date(attempts.locked_until).getTime() > Date.now()) {
        return reply({ success: false, message: "Login temporarily locked. Please try again later." }, 429);
      }
      const { data: access, error: accessError } = await db.from("installation_user_access")
        .select("active").eq("person_id", personId).eq("installation_id", installationId).eq("active", true).maybeSingle();
      if (accessError) throw accessError;
      if (!access) return reply({ success: false, message: "This account is not linked to this installation." }, 403);
      const challenge = await takeChallenge(db, personId, installationId, "authentication");
      if (!challenge) return reply({ success: false, message: "Sign-in request expired. Use your PIN." }, 400);
      const { data: passkey, error } = await db.from("club_checkin_passkeys")
        .select("id,credential_id,public_key,sign_count,transports")
        .eq("person_id", personId).eq("installation_id", installationId).eq("active", true)
        .eq("credential_id", body?.response?.id).maybeSingle();
      if (error) throw error;
      if (!passkey) {
        await recordPasskeyFailure(db, installationId, personId, "credential_not_found");
        return reply({ success: false, message: "Passkey sign-in could not be verified. Use your PIN." }, 401);
      }
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: body.response,
          expectedChallenge: challenge,
          expectedOrigin: APP_ORIGIN,
          expectedRPID: RP_ID,
          requireUserVerification: true,
          credential: {
            id: passkey.credential_id,
            publicKey: decodeBase64Url(passkey.public_key),
            counter: Number(passkey.sign_count),
            transports: passkey.transports,
          },
        });
      } catch (e) {
        console.error("Passkey assertion verification failed:", e);
        await recordPasskeyFailure(db, installationId, personId, "assertion_verification_failed");
        return reply({ success: false, message: "Passkey sign-in could not be verified. Use your PIN." }, 401);
      }
      if (!verification.verified) {
        await recordPasskeyFailure(db, installationId, personId, "assertion_not_verified");
        return reply({ success: false, message: "Passkey sign-in could not be verified. Use your PIN." }, 401);
      }
      await db.from("club_checkin_passkeys").update({
        sign_count: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
      }).eq("id", passkey.id);
      const session = await createSession(db, personId, installationId, user.name);
      await db.from("user_pin_login_attempts").update({
        failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString(),
      }).eq("installation_id", installationId);
      await audit(db, "passkey_login", "success", personId, installationId);
      return reply(session);
    }

    if (action === "registration-options" || action === "registration-verify") {
      if (!(await validSession(db, body?.session_token, personId, installationId))) {
        return reply({ success: false, message: "Your PIN session has expired. Sign in again." }, 401);
      }
      const { data: access, error: accessError } = await db.from("installation_user_access")
        .select("active").eq("person_id", personId).eq("installation_id", installationId).eq("active", true).maybeSingle();
      if (accessError) throw accessError;
      if (!access) return reply({ success: false, message: "This account is not linked to this installation." }, 403);

      if (action === "registration-options") {
        const { data: existing, error } = await db.from("club_checkin_passkeys")
          .select("id").eq("person_id", personId).eq("installation_id", installationId).eq("active", true).maybeSingle();
        if (error) throw error;
        if (existing) return reply({ success: false, message: "A passkey is already registered on this installation." }, 409);
        const options = await generateRegistrationOptions({
          rpName: RP_NAME,
          rpID: RP_ID,
          userName: user.name,
          userDisplayName: user.name,
          attestationType: "none",
          timeout: 60000,
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            residentKey: "preferred",
            userVerification: "required",
          },
          supportedAlgorithmIDs: [-7, -257],
        });
        await saveChallenge(db, personId, installationId, "registration", options.challenge);
        return reply({ success: true, options });
      }

      const challenge = await takeChallenge(db, personId, installationId, "registration");
      if (!challenge) return reply({ success: false, message: "Registration request expired. You can try again later." }, 400);
      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response: body.response,
          expectedChallenge: challenge,
          expectedOrigin: APP_ORIGIN,
          expectedRPID: RP_ID,
          requireUserVerification: true,
          supportedAlgorithmIDs: [-7, -257],
        });
      } catch (e) {
        console.error("Passkey registration verification failed:", e);
        return reply({ success: false, message: "The device could not register a passkey. You can continue using your PIN." }, 400);
      }
      if (!verification.verified || !verification.registrationInfo) {
        return reply({ success: false, message: "Passkey registration could not be verified." }, 400);
      }
      const info = verification.registrationInfo;
      const credential = info.credential;
      const { error: insertError } = await db.from("club_checkin_passkeys").insert({
        person_id: personId,
        installation_id: installationId,
        credential_id: credential.id,
        public_key: encodeBase64Url(credential.publicKey),
        sign_count: credential.counter,
        transports: credential.transports || [],
        device_type: info.credentialDeviceType,
        backed_up: info.credentialBackedUp,
      });
      if (insertError) {
        console.error("Passkey save failed:", insertError.message);
        return reply({ success: false, message: "The passkey could not be saved. You can continue using your PIN." }, 500);
      }
      await audit(db, "passkey_registration", "success", personId, installationId, {
        device_type: info.credentialDeviceType,
        backed_up: info.credentialBackedUp,
      });
      return reply({ success: true });
    }

    return reply({ success: false, message: "Unknown action." }, 400);
  } catch (error) {
    console.error("Passkey service error:", error);
    return reply({ success: false, message: "Passkey service is temporarily unavailable." }, 500);
  }
});

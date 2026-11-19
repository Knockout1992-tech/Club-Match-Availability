
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}


async function markParentActivity(supabase: any, parentAccountId: number, familyId: number | null) {
  const ids = [parentAccountId];
  if (familyId) {
    const { data: members, error } = await supabase
      .from("match_parent_family_members")
      .select("parent_access_id")
      .eq("family_id", familyId);
    if (error) throw new Error("Unable to update family activity");
    for (const member of members ?? []) ids.push(Number(member.parent_access_id));
  }
  const { error } = await supabase
    .from("match_parent_access")
    .update({ last_activity_at: new Date().toISOString() })
    .in("id", [...new Set(ids)]);
  if (error) throw new Error("Unable to update parent activity");
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

async function derivePinHash(pin: string, saltBase64: string): Promise<string> {
  const salt = Uint8Array.from(atob(saltBase64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, key, 256);
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}


async function writeSecurityAudit(
  db: any,
  eventType: string,
  outcome: string,
  severity: string,
  actorReference: number | null,
  details: Record<string, unknown> = {},
) {
  try {
    const { error } = await db.from("system_admin_audit_log").insert({
      source_system: "match_availability_parent_portal",
      severity,
      event_type: eventType,
      outcome,
      actor_type: "parent",
      actor_reference: actorReference === null ? null : String(actorReference),
      details,
    });
    if (error) console.error("Security audit write failed:", error.message);
  } catch (error) {
    console.error("Security audit write failed:", error);
  }
}

async function authenticateParent(supabase: any, parentName: string, pin: string, allowCreate: boolean) {
  const normalisedName = normalise(parentName);
  let { data: account, error } = await supabase.from("match_parent_access")
    .select("id,parent_name,pin_salt,pin_hash,failed_attempts,locked_until")
    .eq("normalised_name", normalisedName).maybeSingle();
  if (error) throw new Error("Unable to verify parent access");

  if (!account && allowCreate) {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = btoa(String.fromCharCode(...saltBytes));
    const hash = await derivePinHash(pin, salt);
    const { data: created, error: createError } = await supabase.from("match_parent_access")
      .insert({ parent_name: parentName.trim(), normalised_name: normalisedName, pin_salt: salt, pin_hash: hash })
      .select("id,parent_name,pin_salt,pin_hash,failed_attempts,locked_until").single();
    if (!createError && created) {
      await writeSecurityAudit(supabase, "parent_account_registered", "success", "info", Number(created.id));
      await writeSecurityAudit(supabase, "parent_pin_verification", "success", "info", Number(created.id), { registration: true });
      return { ok: true, created: true, account: created };
    }
    const retry = await supabase.from("match_parent_access")
      .select("id,parent_name,pin_salt,pin_hash,failed_attempts,locked_until")
      .eq("normalised_name", normalisedName).maybeSingle();
    if (retry.error || !retry.data) throw new Error("Unable to create parent access. Please try again.");
    account = retry.data;
  }

  if (!account) {
    await writeSecurityAudit(supabase, "parent_pin_verification", "failed", "warning", null, { reason: "account_not_found" });
    return { ok: false, status: 401, error: "Parent account not found. Please return to Parent Home and register first." };
  }
  if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
    await writeSecurityAudit(supabase, "parent_pin_verification", "blocked", "warning", Number(account.id), { reason: "account_locked" });
    return { ok: false, status: 429, error: "Too many incorrect PIN attempts. Please try again in 10 minutes." };
  }

  return { ...(await verifyParentPinAtomically(supabase, account, pin)), created: false };
}

async function verifyParentPinAtomically(supabase: any, account: any, pin: string) {
  const suppliedHash = await derivePinHash(pin, account.pin_salt);
  const { data: result, error } = await supabase.rpc("verify_parent_pin_attempt", {
    p_parent_access_id: Number(account.id),
    p_supplied_hash: suppliedHash,
  });
  if (error || !result || typeof result.reason === "undefined" && result.ok !== true) {
    console.error("Parent PIN verification failed:", error?.message);
    throw new Error("Unable to verify parent access");
  }
  if (result.ok === true) {
    return { ok: true, account };
  }
  const reason = result.reason;
  const locked = reason === "five_failed_attempts";
  const blocked = reason === "account_locked";
  const outcome = locked ? "locked_out" : blocked ? "blocked" : "failed";
  const severity = locked ? "critical" : "warning";
  await writeSecurityAudit(supabase, "parent_pin_verification", outcome, severity, Number(account.id), {
    reason: locked ? "five_failed_attempts" : blocked ? "account_locked" : "incorrect_pin",
  });
  return {
    ok: false,
    status: locked || blocked ? 429 : 401,
    error: locked || blocked
      ? "Too many incorrect PIN attempts. Please try again in 10 minutes."
      : "That PIN is incorrect. Please try again.",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return response({ error: "Method not allowed" }, 405);
  }

  let submissionId: number | null = null;
  let supabase: any = null;

  try {
    const body = await req.json();

    const fixtureToken = body?.fixture_token;
    const parentName = body?.parent_name;
    const parentPin = body?.parent_pin;
    const children = body?.children;

    if (
      typeof fixtureToken !== "string" ||
      fixtureToken.length < 32 ||
      fixtureToken.length > 256 ||
      typeof parentName !== "string" ||
      !parentName.trim() ||
      parentName.trim().length > 100 ||
      typeof parentPin !== "string" ||
      !/^\d{6}$/.test(parentPin) ||
      !Array.isArray(children) ||
      children.length < 1 ||
      children.length > 20
    ) {
      return response({ error: "Invalid submission details" }, 400);
    }

    const validChildren = children.every((child: any) =>
      typeof child?.child_name === "string" &&
      child.child_name.trim().length > 0 &&
      child.child_name.trim().length <= 100 &&
      Number.isInteger(child.age_group_id) &&
      child.age_group_id > 0 &&
      (child.school_year === undefined || child.school_year === null ||
        child.school_year === "" ||
        (typeof child.school_year === "string" &&
          /^(1[0-3]|[1-9])$/.test(child.school_year.trim()))) &&
      ["available", "unavailable", "unsure"].includes(child.availability)
    );

    if (!validChildren) {
      return response({
        error: "One or more child details are invalid",
      }, 400);
    }

    // Prevent duplicate children within the same submission.
    const childKeys = children.map((child: any) =>
      `${normalise(child.child_name)}|${child.age_group_id}|${normalise(child.school_year || "")}`
    );

    if (new Set(childKeys).size !== childKeys.length) {
      return response({
        error: "The same child has been entered more than once",
      }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      console.error("Required environment variables are missing");
      return response({ error: "Service unavailable" }, 500);
    }

    supabase = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const parentAccess = await authenticateParent(supabase, parentName.trim(), parentPin, false);
    if (!parentAccess.ok) {
      const failure = parentAccess as { error: string; status: number };
      return response({ error: failure.error }, failure.status);
    }
    if (!("account" in parentAccess) || !parentAccess.account) {
      return response({ error: "Unable to verify parent access" }, 401);
    }
    const parentAccountId = Number(parentAccess.account.id);
    const { data: familyMembership, error: familyMembershipError } = await supabase
      .from("match_parent_family_members").select("family_id").eq("parent_access_id", parentAccountId).maybeSingle();
    if (familyMembershipError) return response({ error: "Unable to load family access" }, 500);
    const familyId = familyMembership?.family_id ?? null;

    // Find the fixture using its private public-link token.
    const fixtureHash = await hashToken(fixtureToken);

    const { data: fixture, error: fixtureError } = await supabase
      .from("match_fixtures")
      .select(`
        id,
        status,
        response_deadline,
        match_fixture_age_groups (
          age_group_id,
          age_groups (
            id,
            age_group,
            active
          )
        )
      `)
      .eq("public_token_hash", fixtureHash)
      .maybeSingle();

    if (fixtureError) {
      console.error("Fixture lookup failed:", fixtureError.message);
      return response({ error: "Unable to verify fixture" }, 500);
    }

    if (!fixture || fixture.status !== "open") {
      return response({
        error: "This fixture link is unavailable",
      }, 404);
    }

    if (
      fixture.response_deadline &&
      new Date(fixture.response_deadline).getTime() <= Date.now()
    ) {
      return response({
        error: "The response deadline has passed",
      }, 410);
    }

    const allowedGroups = (fixture.match_fixture_age_groups ?? [])
      .map((item: any) => item.age_groups)
      .filter((group: any) => group?.active);

    const allowedGroupIds = new Set(
      allowedGroups.map((group: any) => group.id),
    );

    if (children.some((child: any) =>
      !allowedGroupIds.has(child.age_group_id)
    )) {
      return response({
        error: "A child has an age group not included in this fixture",
      }, 400);
    }

    const groupNames = new Map<number, string>(
      allowedGroups.map((group: any) => [group.id, group.age_group]),
    );

    // Check existing player records for possible duplicates.
    const playerAgeGroups = [
      ...new Set(
        children.map((child: any) =>
          groupNames.get(child.age_group_id)
        ),
      ),
    ];

    const { data: existingPlayers, error: playersError } = await supabase
      .from("players")
      .select("player_id, name, age_group")
      .in("age_group", playerAgeGroups);

    if (playersError) {
      console.error(
        "Player duplicate lookup failed:",
        playersError.message,
      );
      return response({
        error: "Unable to check existing players",
      }, 500);
    }

    // Check previous parent submissions for possible duplicates.
    const groupIds = [
      ...new Set(children.map((child: any) => child.age_group_id)),
    ];

    const { data: previousSubmissions, error: submissionsError } =
      await supabase
        .from("match_availability")
        .select("child_name, age_group_id, school_year")
        .in("age_group_id", groupIds);

    if (submissionsError) {
      console.error(
        "Previous submission lookup failed:",
        submissionsError.message,
      );
      return response({
        error: "Unable to check previous submissions",
      }, 500);
    }

    // Create a private edit token so the parent can retrieve and amend this response.
    const editTokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const editToken = Array.from(editTokenBytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const editTokenHash = await hashToken(editToken);

    if (familyId) {
      const { data: existingFamilySubmission, error: existingFamilyError } = await supabase
        .from("match_submissions").select("id").eq("family_id", familyId).eq("fixture_id", fixture.id).maybeSingle();
      if (existingFamilyError) return response({ error: "Unable to check shared family response" }, 500);
      if (existingFamilySubmission) return response({ error: "A linked parent has already started a response for this fixture. Please return to your fixture list and reopen it to see the latest response." }, 409);
    }
    const { data: submission, error: submissionError } = await supabase
      .from("match_submissions")
      .insert({
        fixture_id: fixture.id,
        parent_name: parentName.trim(),
        parent_contact: null,
        edit_token_hash: editTokenHash,
        family_id: familyId,
        last_updated_by_parent_id: parentAccountId,
      })
      .select("id")
      .single();

    if (submissionError || !submission) {
      console.error(
        "Submission creation failed:",
        submissionError?.message,
      );
      return response({
        error: "Unable to save submission",
      }, 500);
    }

    submissionId = submission.id;

    const availabilityRows = children.map((child: any) => {
      const childName = normalise(child.child_name);
      const schoolYear = normalise(child.school_year || "");
      const ageGroupId = child.age_group_id;
      const ageGroupName = groupNames.get(ageGroupId);

      const playerDuplicate = (existingPlayers ?? []).some(
        (player: any) =>
          normalise(player.name) === childName &&
          player.age_group === ageGroupName,
      );

      const submissionDuplicate = (previousSubmissions ?? []).some(
        (previous: any) =>
          normalise(previous.child_name) === childName &&
          previous.age_group_id === ageGroupId &&
          normalise(previous.school_year || "") === schoolYear,
      );

      return {
        submission_id: submission.id,
        child_name: child.child_name.trim(),
        age_group_id: ageGroupId,
        school_year: child.school_year ? child.school_year.trim() : null,
        availability: child.availability,
        duplicate_review_status:
          playerDuplicate || submissionDuplicate
            ? "pending"
            : "not_checked",
      };
    });

    const { error: availabilityError } = await supabase
      .from("match_availability")
      .insert(availabilityRows);

    if (availabilityError) {
      console.error(
        "Availability creation failed:",
        availabilityError.message,
      );

      await supabase
        .from("match_submissions")
        .delete()
        .eq("id", submission.id);

      submissionId = null;

      return response({
        error: "Unable to save child availability",
      }, 500);
    }

    await markParentActivity(supabase, parentAccountId, familyId);

    return response({
      success: true,
      submission_id: submission.id,
      edit_token: editToken,
      children_submitted: availabilityRows.length,
    });

  } catch (error) {
    console.error("Unexpected submit_availability error:", error);

    if (submissionId !== null && supabase !== null) {
      const { error: cleanupError } = await supabase
        .from("match_submissions")
        .delete()
        .eq("id", submissionId);

      if (cleanupError) {
        console.error(
          "Submission cleanup failed:",
          cleanupError.message,
        );
      }
    }

    return response({ error: "Invalid request" }, 400);
  }
});


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

async function encryptToken(token: string): Promise<string> {
  const secret = Deno.env.get("FIXTURE_TOKEN_ENCRYPTION_KEY");

  if (!secret) {
    throw new Error("Fixture encryption key is missing");
  }

  const rawKey = Uint8Array.from(
    atob(secret),
    (character) => character.charCodeAt(0),
  );

  if (rawKey.length !== 32) {
    throw new Error("Fixture encryption key must be 32 bytes");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(token),
  );

  return JSON.stringify({
    iv: btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(
      String.fromCharCode(...new Uint8Array(encrypted)),
    ),
  });
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}


async function writeSecurityAudit(db: any, eventType: string, outcome: string, severity: string, actorType: string, actorReference: string | null, details: Record<string, unknown> = {}) {
  try {
    const { error } = await db.from("system_admin_audit_log").insert({
      source_system: "match_availability_parent_portal",
      severity, event_type: eventType, outcome, actor_type: actorType,
      actor_reference: actorReference, details,
    });
    if (error) console.error("Security audit write failed:", error.message);
  } catch (error) { console.error("Security audit write failed:", error); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return response({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();

    const installationId = body?.installation_id;
    const seniorCode = body?.senior_code;
    const coachCode = body?.coach_code;

    const opposition =
      typeof body?.opposition === "string"
        ? body.opposition.trim()
        : "";

    const fixtureDate = body?.fixture_date;
    const fixtureType = body?.fixture_type;
    const ageGroupIds = body?.age_group_ids;

    const hasSeniorCode =
      typeof seniorCode === "string" &&
      seniorCode.trim().length > 0;

    const hasCoachCode =
      typeof coachCode === "string" &&
      coachCode.trim().length > 0;

    // Require installation ID and exactly one access code.
    if (
      typeof installationId !== "string" ||
      !installationId.trim() ||
      hasSeniorCode === hasCoachCode
    ) {
      return response({ error: "Admin access required" }, 401);
    }

    // Validate fixture details.
    if (
      !opposition ||
      typeof fixtureDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fixtureDate) ||
      !["home", "away"].includes(fixtureType) ||
      !Array.isArray(ageGroupIds) ||
      ageGroupIds.length === 0 ||
      !ageGroupIds.every(
        (id: unknown) =>
          Number.isInteger(id) &&
          typeof id === "number" &&
          id > 0
      )
    ) {
      return response({ error: "Invalid fixture details" }, 400);
    }

    const uniqueAgeGroupIds = [...new Set(ageGroupIds)];

    // Connect using the service role.
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      console.error(
        "Required Supabase environment variables are missing",
      );
      return response({ error: "Service unavailable" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify the installation belongs to an active approved user.
    const { data: personId, error: accessError } = await supabase.rpc(
      "verify_installation_access",
      {
        requested_installation_id: installationId.trim(),
      },
    );

    if (accessError || !personId) {
      console.error(
        "Installation verification failed:",
        accessError?.message,
      );

      return response({ error: "Admin access required" }, 401);
    }

const requestedRole = hasCoachCode ? "coach" : "senior";
    const suppliedCode = hasCoachCode ? coachCode : seniorCode;
    const { data: codeValid, error: codeError } = await supabase.rpc(
      "verify_access_code_for_installation",
      {
        supplied_code: suppliedCode,
        code_type: requestedRole,
        supplied_installation_id: installationId.trim(),
      },
    );
    if (codeError) {
      console.error("Access code verification failed:", codeError.message);
      return response({
        error: requestedRole === "coach" ? "Unable to verify Coach access" : "Unable to verify Admin access",
      }, 500);
    }
    if (codeValid !== true) {
      return response({
        error: requestedRole === "coach" ? "Invalid Coach access code" : "Invalid Admin access code",
      }, 401);
    }

    // Coach operations require an individual authenticated session.
    // The shared Coach PIN is only for first-time personal PIN setup.
    let authenticatedPersonId = personId;
    if (requestedRole === "coach") {
      if (!/^[0-9a-f]{64}$/.test(suppliedCode)) {
        return response({ error: "Please sign in with your personal Coach PIN before continuing" }, 401);
      }
      const { data: sessionPersonId, error: sessionError } = await supabase.rpc(
        "get_authenticated_person_id",
        {
          supplied_credential: suppliedCode,
          required_access_role: "coach",
          supplied_installation_id: installationId.trim(),
        },
      );
      if (sessionError || !sessionPersonId) {
        return response({ error: "Your Coach session is no longer valid. Please sign in again." }, 401);
      }
      authenticatedPersonId = sessionPersonId;
    }

    if (requestedRole === "coach") {
      const { data: assignments, error: assignmentsError } = await supabase
        .from("user_age_group_assignments")
        .select("age_group_id")
        .eq("person_id", authenticatedPersonId);
      if (assignmentsError) {
        console.error("Coach age-group lookup failed:", assignmentsError.message);
        return response({ error: "Unable to verify Coach age-group access" }, 500);
      }
      const assignedIDs = new Set((assignments ?? []).map((item: any) => Number(item.age_group_id)));
      if (uniqueAgeGroupIds.some((id: number) => !assignedIDs.has(id))) {
        await writeSecurityAudit(supabase, "fixture_create_access", "denied", "warning", "coach", installationId.trim(), {
          reason: "unassigned_age_group_requested",
          requested_age_group_ids: uniqueAgeGroupIds,
        });
        return response({ error: "You can only create fixtures for age groups assigned to your Coach account" }, 403);
      }
    }

    // Confirm all selected age groups exist and are active.
    const { data: ageGroups, error: ageError } = await supabase
      .from("age_groups")
      .select("id")
      .in("id", uniqueAgeGroupIds)
      .eq("active", true);

    if (ageError) {
      console.error("Age group lookup failed:", ageError.message);

      return response(
        { error: "Unable to validate age groups" },
        500,
      );
    }

    if (
      !ageGroups ||
      ageGroups.length !== uniqueAgeGroupIds.length
    ) {
      return response(
        { error: "One or more age groups are invalid" },
        400,
      );
    }

    // Generate a secure public fixture token.
    const token = generateToken();
    const tokenHash = await hashToken(token);
    const encryptedToken = await encryptToken(token);

    // Prepare the fixture.
    const fixtureData = {
      opposition,
      fixture_date: fixtureDate,
      fixture_type: fixtureType,
      kick_off_time: body?.kick_off_time || null,
      venue:
        typeof body?.venue === "string"
          ? body.venue.trim() || null
          : null,
      venue_address:
        typeof body?.venue_address === "string"
          ? body.venue_address.trim() || null
          : null,
      response_deadline: body?.response_deadline || null,
      public_token_hash: tokenHash,
      public_token_encrypted: encryptedToken,
      status: "draft",
    };

    // Create the fixture as a draft.
    const { data: fixture, error: fixtureError } = await supabase
      .from("match_fixtures")
      .insert(fixtureData)
      .select("id")
      .single();

    if (fixtureError || !fixture) {
      console.error(
        "Fixture creation failed:",
        fixtureError?.message,
        fixtureError?.code,
      );

      return response(
        { error: "Unable to create fixture" },
        500,
      );
    }

    // Link the selected age groups.
    const ageGroupRows = uniqueAgeGroupIds.map((id: number) => ({
      fixture_id: fixture.id,
      age_group_id: id,
    }));

    const { error: linkError } = await supabase
      .from("match_fixture_age_groups")
      .insert(ageGroupRows);

    if (linkError) {
      console.error(
        "Age group linking failed:",
        linkError.message,
        linkError.code,
      );

      // Remove the incomplete draft if linking failed.
      const { error: deleteError } = await supabase
        .from("match_fixtures")
        .delete()
        .eq("id", fixture.id);

      if (deleteError) {
        console.error(
          "Failed to remove incomplete fixture:",
          deleteError.message,
        );
      }

      return response(
        { error: "Unable to assign age groups" },
        500,
      );
    }

    await writeSecurityAudit(supabase, "fixture_created", "success", "info", requestedRole, installationId.trim(), {
      fixture_id: Number(fixture.id), age_group_count: uniqueAgeGroupIds.length,
    });

    // Return the plaintext token once only.
    return response({
      success: true,
      fixture_id: fixture.id,
      status: "draft",
      parent_token: token,
    });

  } catch (error) {
    console.error("Unexpected create_fixture error:", error);

    return response({ error: "Invalid request" }, 400);
  }
});

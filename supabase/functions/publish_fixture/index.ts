
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
    const fixtureId = body?.fixture_id;

    const hasSeniorCode =
      typeof seniorCode === "string" &&
      seniorCode.trim().length > 0;

    const hasCoachCode =
      typeof coachCode === "string" &&
      coachCode.trim().length > 0;

    // Require installation ID, exactly one access code and a valid fixture ID.
    if (
      typeof installationId !== "string" ||
      !installationId.trim() ||
      hasSeniorCode === hasCoachCode ||
      !Number.isInteger(fixtureId) ||
      fixtureId <= 0
    ) {
      return response({ error: "Invalid request details" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      console.error("Required environment variables are missing");
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
      const { data: fixtureGroups, error: fixtureGroupsError } = await supabase
        .from("match_fixture_age_groups")
        .select("age_group_id")
        .eq("fixture_id", fixtureId);
      if (fixtureGroupsError || !fixtureGroups || fixtureGroups.length === 0) {
        return response({ error: "Unable to verify fixture age groups" }, 500);
      }
      if (fixtureGroups.some((group: any) => !assignedIDs.has(Number(group.age_group_id)))) {
        await writeSecurityAudit(supabase, "fixture_publish_access", "denied", "warning", "coach", installationId.trim(), {
          reason: "fixture_contains_unassigned_age_group",
          fixture_id: Number(fixtureId),
        });
        return response({ error: "You can only publish fixtures for age groups assigned to your Coach account" }, 403);
      }
    }

    // Only draft fixtures can be published.
    const { data: fixture, error: updateError } = await supabase
      .from("match_fixtures")
      .update({ status: "open" })
      .eq("id", fixtureId)
      .eq("status", "draft")
      .select("id, status")
      .maybeSingle();

    if (updateError) {
      console.error(
        "Fixture publishing failed:",
        updateError.message,
      );

      return response(
        { error: "Unable to publish fixture" },
        500,
      );
    }

    if (fixture) {
      await writeSecurityAudit(supabase, "fixture_published", "success", "info", requestedRole, installationId.trim(), {
        fixture_id: Number(fixture.id),
      });
    }

    if (!fixture) {
      const { data: existingFixture, error: lookupError } =
        await supabase
          .from("match_fixtures")
          .select("id, status")
          .eq("id", fixtureId)
          .maybeSingle();

      if (lookupError) {
        console.error(
          "Fixture lookup failed:",
          lookupError.message,
        );

        return response(
          { error: "Unable to check fixture" },
          500,
        );
      }

      if (!existingFixture) {
        return response({ error: "Fixture not found" }, 404);
      }

      return response({
        error: "Only draft fixtures can be published",
        current_status: existingFixture.status,
      }, 409);
    }

    return response({
      success: true,
      fixture_id: fixture.id,
      status: fixture.status,
    });

  } catch (error) {
    console.error("Unexpected publish_fixture error:", error);

    return response({ error: "Invalid request" }, 400);
  }
});

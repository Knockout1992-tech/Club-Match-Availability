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

async function writeSecurityAudit(db: any, eventType: string, outcome: string, severity: string, actorReference: string | null, details: Record<string, unknown> = {}) {
  try {
    const { error } = await db.from("system_admin_audit_log").insert({
      source_system: "match_availability_parent_portal",
      severity,
      event_type: eventType,
      outcome,
      actor_type: "installation",
      actor_reference: actorReference,
      details,
    });
    if (error) console.error("Security audit write failed:", error.message);
  } catch (error) {
    console.error("Security audit write failed:", error);
  }
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
    const action = body?.action;
    const childId = body?.child_id;
    const availability = body?.availability;
    const selectedAgeGroups = body?.selected_age_groups;

    const hasSeniorCode =
      typeof seniorCode === "string" && seniorCode.length > 0;

    const hasCoachCode =
      typeof coachCode === "string" && coachCode.length > 0;

    if (
      typeof installationId !== "string" ||
      !installationId.trim() ||
      hasSeniorCode === hasCoachCode ||
      !["update_availability", "delete_duplicate"].includes(action) ||
      !Number.isInteger(childId) ||
      childId <= 0 ||
      (action === "update_availability" &&
        !["available", "unavailable", "unsure"].includes(availability))
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

    // =====================================================
    // VERIFY INSTALLATION
    // =====================================================

    const { data: personId, error: accessError } =
      await supabase.rpc("verify_installation_access", {
        requested_installation_id: installationId.trim(),
      });

    if (accessError || !personId) {
      console.error(
        "Installation verification failed:",
        accessError?.message,
      );
      await writeSecurityAudit(supabase, "child_response_management_access", "denied", "warning", installationId.trim(), {
        reason: "installation_not_authorised",
      });
      return response({ error: "Access denied" }, 401);
    }

    // =====================================================
    // VERIFY ROLE
    // =====================================================

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

    let authorisedAgeGroupIDs: number[] = [];
    if (requestedRole === "coach") {
      const { data: assignments, error: assignmentsError } = await supabase
        .from("user_age_group_assignments")
        .select("age_group_id")
        .eq("person_id", personId);
      if (assignmentsError) {
        console.error("Coach age-group lookup failed:", assignmentsError.message);
        return response({ error: "Unable to verify Coach age-group access" }, 500);
      }
      authorisedAgeGroupIDs = [...new Set((assignments ?? []).map((item: any) => Number(item.age_group_id)))];
      if (authorisedAgeGroupIDs.length === 0) {
        return response({ error: "No age groups are assigned to this Coach account" }, 403);
      }
    }

    // FIND CHILD
    // =====================================================

    const { data: child, error: childError } =
      await supabase
        .from("match_availability")
        .select("id, submission_id, duplicate_review_status, age_group_id")
        .eq("id", childId)
        .maybeSingle();

    if (childError) {
      console.error("Child lookup failed:", childError.message);
      return response({ error: "Unable to find child entry" }, 500);
    }

    if (!child) {
      return response({ error: "Child entry not found" }, 404);
    }

    if (requestedRole === "coach" &&
        !authorisedAgeGroupIDs.includes(Number(child.age_group_id))) {
      await writeSecurityAudit(supabase, "child_response_management_access", "denied", "warning", installationId.trim(), {
        reason: "age_group_not_assigned",
        role: requestedRole,
        age_group_id: Number(child.age_group_id),
      });
      return response({ error: "You can only manage responses for age groups assigned to your Coach account" }, 403);
    }

    // =====================================================
    // FIND PARENT SUBMISSION AND FIXTURE
    // =====================================================

    const { data: submission, error: submissionError } =
      await supabase
        .from("match_submissions")
        .select("fixture_id")
        .eq("id", child.submission_id)
        .maybeSingle();

    if (submissionError || !submission) {
      console.error(
        "Submission lookup failed:",
        submissionError?.message,
      );

      return response({ error: "Unable to verify fixture" }, 500);
    }

    const { data: fixture, error: fixtureError } =
      await supabase
        .from("match_fixtures")
        .select("id, status")
        .eq("id", submission.fixture_id)
        .maybeSingle();

    if (fixtureError || !fixture) {
      console.error(
        "Fixture lookup failed:",
        fixtureError?.message,
      );

      return response({ error: "Unable to verify fixture" }, 500);
    }

    if (fixture.status !== "open") {
      return response({
        error: "Changes can only be made to open fixtures",
      }, 403);
    }

    // =====================================================
    // UPDATE AVAILABILITY
    // =====================================================

    const { data: allowed, error: lockCheckError } = await supabase.rpc(
      "coach_manage_match_child",
      { p_child_id: childId, p_action: action, p_availability: availability ?? null },
    );

    if (lockCheckError) {
      console.error("Parent edit lock check failed:", lockCheckError.message);
      return response({ error: "Unable to verify whether the parent is editing this response." }, 500);
    }

    if (allowed !== true) {
      return response({
        error: "The parent is currently editing this response. Please try again when they have finished.",
      }, 409);
    }

    return response({
      success: true,
      action,
      child_id: childId,
      ...(action === "update_availability" ? { availability } : {}),
    });

    if (action === "update_availability") {
      const { data: updatedChild, error: updateError } =
        await supabase
          .from("match_availability")
          .select("id, availability")
          .eq("id", childId)
          .maybeSingle();

      if (updateError || !updatedChild) {
        console.error(
          "Availability update failed:",
          updateError?.message,
        );

        return response({
          error: "Unable to update availability",
        }, 500);
      }

      return response({
        success: true,
        action: "update_availability",
        child_id: updatedChild.id,
        availability: updatedChild.availability,
      });
    }

    // =====================================================
    // DELETE POTENTIAL DUPLICATE
    // =====================================================

    if (action === "delete_duplicate") {
      const { data: deletedChild, error: deleteError } =
        await supabase
          .from("match_availability")
          .delete()
          .eq("id", childId)
          .select("id")
          .maybeSingle();

      if (deleteError || !deletedChild) {
        console.error(
          "Duplicate deletion failed:",
          deleteError?.message,
        );

        return response({
          error: "Unable to delete duplicate entry",
        }, 500);
      }

      return response({
        success: true,
        action: "delete_duplicate",
        child_id: deletedChild.id,
      });
    }

    return response({ error: "Unsupported action" }, 400);

  } catch (error) {
    console.error("Unexpected manage_match_child error:", error);
    return response({ error: "Invalid request" }, 400);
  }
});
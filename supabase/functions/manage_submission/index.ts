
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

async function writeSecurityAudit(db:any,eventType:string,outcome:string,severity:string,actorReference:string|null,details:Record<string,unknown>={}){try{const {error}=await db.from("system_admin_audit_log").insert({source_system:"match_availability_parent_portal",severity,event_type:eventType,outcome,actor_type:"public_link",actor_reference:actorReference,details});if(error)console.error("Security audit write failed:",error.message);}catch(error){console.error("Security audit write failed:",error);}}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return response({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();

    const action = body?.action;
    const editToken = body?.edit_token;

    if (
      !["load", "update", "lock", "heartbeat", "unlock"].includes(action) ||
      typeof editToken !== "string" ||
      editToken.length < 32 ||
      editToken.length > 256
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

    const tokenHash = await hashToken(editToken);
    const lockToken = body?.lock_token;

    if (["lock", "heartbeat", "unlock", "update"].includes(action) &&
        (typeof lockToken !== "string" || lockToken.length < 32 || lockToken.length > 256)) {
      return response({ error: "Invalid editing session. Please reopen your response." }, 400);
    }

    if (["lock", "heartbeat", "unlock"].includes(action)) {
      const { data: locked, error: lockError } = await supabase.rpc(
        "parent_manage_submission_lock",
        {
          p_edit_token_hash: tokenHash,
          p_lock_token_hash: await hashToken(lockToken),
          p_action: action === "lock" ? "acquire" : action === "unlock" ? "release" : "heartbeat",
        },
      );

      if (lockError) {
        console.error("Parent edit lock failed:", lockError.message);
        return response({ error: "Unable to secure this response for editing." }, 500);
      }

      if (locked !== true) {
        return response({
          error: action === "unlock"
            ? "This editing session has expired."
            : "This response is currently being edited elsewhere. Please try again shortly.",
        }, 409);
      }

      return response({ success: true, locked: action !== "unlock" });
    }

    // Find the submission using its edit token.
    const { data: submission, error: submissionError } = await supabase
      .from("match_submissions")
      .select(`
        id,
        fixture_id,
        parent_name,
        parent_contact,
        submitted_at,
        updated_at,
        family_id,
        last_updated_by_parent_id,
        match_fixtures (
          status,
          response_deadline
        )
      `)
      .eq("edit_token_hash", tokenHash)
      .maybeSingle();

    if (submissionError) {
      console.error("Submission lookup failed:", submissionError.message);
      return response({ error: "Unable to load submission" }, 500);
    }

    if (!submission) {
      await writeSecurityAudit(supabase, "submission_edit_link", "failed", "warning", null, { reason: "invalid_edit_token" });
      return response({ error: "Invalid edit link" }, 404);
    }

    const fixture = submission.match_fixtures as any;

    const deadlinePassed =
      fixture?.response_deadline &&
      new Date(fixture.response_deadline).getTime() <= Date.now();

    const canEdit =
      fixture?.status === "open" && !deadlinePassed;

    if (action === "load") {
      const { data: children, error: childrenError } = await supabase
        .from("match_availability")
        .select(`
          id,
          child_name,
          age_group_id,
          school_year,
          availability,
          duplicate_review_status
        `)
        .eq("submission_id", submission.id)
        .order("id");

      if (childrenError) {
        console.error("Child lookup failed:", childrenError.message);
        return response({ error: "Unable to load children" }, 500);
      }

      return response({
        success: true,
        submission: {
          id: submission.id,
          parent_name: submission.parent_name,
          parent_contact: submission.parent_contact,
          can_edit: Boolean(canEdit),
          children: children ?? [],
        },
      });
    }

    // Availability changes are applied atomically with the active parent edit lock.
    if (!canEdit) {
      return response({ error: "This fixture is closed for amendments" }, 410);
    }

    const children = body?.children;
    if (!Array.isArray(children) || children.length < 1 || children.length > 20) {
      return response({ error: "Invalid child updates" }, 400);
    }

    const validChildren = children.every((child: any) => {
      if (!["available", "unavailable", "unsure"].includes(child?.availability)) return false;
      if (child.id !== undefined && child.id !== null) {
        return Number.isInteger(child.id) && child.id > 0;
      }
      return typeof child.child_name === "string" &&
        child.child_name.trim().length > 0 &&
        child.child_name.trim().length <= 100 &&
        Number.isInteger(child.age_group_id) && child.age_group_id > 0 &&
        (child.school_year === undefined || child.school_year === null ||
          child.school_year === "" ||
          (typeof child.school_year === "string" &&
            /^(1[0-3]|[1-9])$/.test(child.school_year.trim())));
    });
    const existingIds = children.filter((child: any) => child.id !== undefined && child.id !== null).map((child: any) => child.id);
    if (!validChildren || new Set(existingIds).size !== existingIds.length) {
      return response({ error: "One or more child details are invalid" }, 400);
    }

    const { data: updatedCount, error: updateError } = await supabase.rpc(
      "parent_update_submission_availability",
      {
        p_edit_token_hash: tokenHash,
        p_lock_token_hash: await hashToken(lockToken),
        p_children: children.map((child: any) => child.id !== undefined && child.id !== null
          ? ({ id: child.id, availability: child.availability })
          : ({
              child_name: child.child_name.trim(),
              age_group_id: child.age_group_id,
              school_year: child.school_year ? child.school_year.trim() : null,
              availability: child.availability,
            })),
      },
    );

    if (updateError || !Number.isInteger(updatedCount)) {
      console.error("Atomic parent response update failed:", updateError?.message);
      return response({
        error: updateError?.message?.includes("no longer locked")
          ? "Your editing session has expired. Please reopen your response and try again."
          : updateError?.message || "Unable to update your response.",
      }, 409);
    }

    const activityIds = submission.last_updated_by_parent_id
      ? [Number(submission.last_updated_by_parent_id)]
      : [];
    if (submission.family_id) {
      const { data: members, error: membersError } = await supabase
        .from("match_parent_family_members")
        .select("parent_access_id")
        .eq("family_id", submission.family_id);
      if (membersError) throw new Error("Unable to update family activity");
      for (const member of members ?? []) activityIds.push(Number(member.parent_access_id));
    }
    if (activityIds.length) {
      const { error: activityError } = await supabase
        .from("match_parent_access")
        .update({ last_activity_at: new Date().toISOString() })
        .in("id", [...new Set(activityIds)]);
      if (activityError) throw new Error("Unable to update parent activity");
    }

    return response({
      success: true,
      submission_id: submission.id,
      children_updated: children.length,
    });

  } catch (error) {
    console.error("Unexpected manage_submission error:", error);
    return response({ error: "Invalid request" }, 400);
  }
});

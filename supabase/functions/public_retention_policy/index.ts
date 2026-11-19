import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {...corsHeaders,"Content-Type":"application/json","Cache-Control":"no-store, max-age=0"},
  });
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:corsHeaders});
  if (req.method !== "GET") return reply({error:"Method not allowed"},405);
  try {
    const url=Deno.env.get("SUPABASE_URL");
    const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!key)return reply({error:"Service unavailable"},503);
    const db=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data,error}=await db.from("retention_policies")
      .select("policy_key,record_type,retention_value,retention_unit,action,enforcement_enabled")
      .eq("enabled",true).order("policy_key");
    if(error)throw error;
    const {data:policy,error:policyError}=await db.from("club_policy_content")
      .select("content").eq("singleton",true).single();
    if(policyError)throw policyError;
    return reply({success:true,policies:data??[],policy_content:policy?.content??{}});
  } catch(error) {
    console.error("Public privacy policy content lookup failed:",error);
    return reply({error:"Unable to load the current policy content"},500);
  }
});
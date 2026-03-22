// Edge Function: Signup form handler (TypeScript)
// Assumptions:
// - This function validates a signup payload and calls Supabase Auth via the service role key.
// - This is an example backend endpoint; UI still belongs in your frontend repo.

interface SignupPayload { 
  email: string; 
  password: string; 
}

Deno.serve(async (req: Request) => { 
  try { 
    if (req.method !== "POST") { 
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json" } }); 
    } 
    
    const body: SignupPayload = await req.json(); 
    const { email, password } = body;

    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Missing email or password" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // call Supabase Auth REST API using service role key
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("Supabase_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("Supabase_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Supabase environment not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    const resp = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: false
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: data?.message ?? "Signup failed", details: data }), { status: resp.status, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, user: data }), { status: 201, headers: { "Content-Type": "application/json" } });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

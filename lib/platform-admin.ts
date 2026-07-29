import { createAdminClient } from "@/lib/supabase/admin";

/** Fails closed when the service role or platform registry is unavailable. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("platform_admins").select("user_id").eq("user_id", userId).eq("active", true).maybeSingle();
    return !error && Boolean(data);
  } catch {
    return false;
  }
}

export async function getPlatformAdmin(userId:string):Promise<{user_id:string;role:"support"|"operations"|"super_admin"}|null>{
  try{const admin=createAdminClient();const{data,error}=await admin.from("platform_admins").select("user_id,role").eq("user_id",userId).eq("active",true).maybeSingle();return error||!data?null:data as any;}catch{return null;}
}

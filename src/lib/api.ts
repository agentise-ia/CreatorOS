import type { ProcessingJob, ModelProvider } from '@/types';
import supabase from './supabase';

async function getUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

export async function scrapeProfile(
  usernames: string[],
  profileType?: 'reference' | 'own'
): Promise<{ job_id: string }> {
  const user_id = await getUserId();
  const body: Record<string, unknown> = { usernames, user_id };
  if (profileType) body.profile_type = profileType;
  const { data, error } = await supabase.functions.invoke('scrape-profiles', {
    body,
  });

  if (error) {
    throw new Error(`Failed to start scrape job: ${error.message}`);
  }

  // Edge function may return error in body when --no-verify-jwt
  if (data?.error) {
    throw new Error(`Scrape failed: ${data.error}`);
  }

  return data as { job_id: string };
}

export async function cancelJob(jobId: string): Promise<void> {
  const { error } = await supabase
    .from('processing_jobs')
    .update({
      status: 'cancelled',
      error_message: 'Cancelado pelo usuário',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .in('status', ['pending', 'processing']);

  if (error) {
    throw new Error(`Falha ao cancelar: ${error.message}`);
  }
}

export async function getJobStatus(jobId: string): Promise<ProcessingJob> {
  const { data, error } = await supabase
    .from('processing_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch job status: ${error.message}`);
  }

  return data as ProcessingJob;
}

export async function scrapeReelUrl(
  reelUrl: string
): Promise<{ job_id: string }> {
  const user_id = await getUserId();

  // Use fetch directly for better error messages from edge function
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? supabaseKey;

  const response = await fetch(
    `${supabaseUrl}/functions/v1/scrape-reel-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseKey,
      },
      body: JSON.stringify({ reel_url: reelUrl, user_id }),
    }
  );

  const data = await response.json();

  if (!response.ok || data?.error) {
    throw new Error(data?.error ?? `Erro ${response.status}`);
  }

  return data as { job_id: string };
}

export async function analyzeContent(
  reelIds: string[],
  modelProvider: ModelProvider,
  modelId: string,
  profileId?: string
): Promise<{ job_id: string }> {
  const user_id = await getUserId();
  const { data, error } = await supabase.functions.invoke('analyze-content', {
    body: { reel_ids: reelIds, user_id, profile_id: profileId, model_provider: modelProvider, model_id: modelId },
  });

  if (error) {
    throw new Error(`Failed to start analysis job: ${error.message}`);
  }

  return data as { job_id: string };
}

export async function generateVoiceProfile(
  profileId: string,
  reelIds: string[],
  modelProvider: ModelProvider,
  modelId: string
): Promise<{ job_id: string }> {
  const user_id = await getUserId();
  const { data, error } = await supabase.functions.invoke(
    'generate-voice-profile',
    {
      body: { profile_id: profileId, reel_ids: reelIds, user_id, model_provider: modelProvider, model_id: modelId },
    }
  );

  if (error) {
    throw new Error(`Failed to start voice profile generation: ${error.message}`);
  }

  return data as { job_id: string };
}

export async function saveScriptEdit(
  scriptId: string,
  teleprompterText: string
): Promise<void> {
  // Get current max version number
  const { data: versions } = await supabase
    .from('script_versions')
    .select('version_number')
    .eq('script_id', scriptId)
    .order('version_number', { ascending: false })
    .limit(1)

  const maxVersion = (versions && versions.length > 0)
    ? (versions[0] as { version_number: number }).version_number
    : 0

  // Get current script data for snapshot
  const { data: script, error: fetchError } = await supabase
    .from('scripts')
    .select('script_teleprompter, script_annotated, editing_report')
    .eq('id', scriptId)
    .single()

  if (fetchError || !script) throw new Error('Failed to fetch current script')

  // Create new version with the new content
  const { error: versionError } = await supabase.from('script_versions').insert({
    script_id: scriptId,
    version_number: maxVersion + 1,
    script_teleprompter: teleprompterText,
    script_annotated: (script as Record<string, unknown>).script_annotated ?? {},
    editing_report: (script as Record<string, unknown>).editing_report ?? {},
    change_type: 'manual_edit',
    change_description: 'Edição manual do roteiro',
  })

  if (versionError) throw new Error(`Failed to create version: ${versionError.message}`)

  // Update the script
  const { error: updateError } = await supabase
    .from('scripts')
    .update({
      script_teleprompter: teleprompterText,
      updated_at: new Date().toISOString(),
    })
    .eq('id', scriptId)

  if (updateError) throw new Error(`Failed to update script: ${updateError.message}`)
}

export async function restoreScriptVersion(
  scriptId: string,
  versionId: string
): Promise<void> {
  // Fetch the version to restore
  const { data: version, error: versionError } = await supabase
    .from('script_versions')
    .select('*')
    .eq('id', versionId)
    .single()

  if (versionError || !version) throw new Error('Version not found')

  const v = version as {
    version_number: number
    script_teleprompter: string
    script_annotated: Record<string, unknown>
    editing_report: Record<string, unknown>
  }

  // Get max version number
  const { data: versions } = await supabase
    .from('script_versions')
    .select('version_number')
    .eq('script_id', scriptId)
    .order('version_number', { ascending: false })
    .limit(1)

  const maxVersion = (versions && versions.length > 0)
    ? (versions[0] as { version_number: number }).version_number
    : 0

  // Create new version as restoration
  await supabase.from('script_versions').insert({
    script_id: scriptId,
    version_number: maxVersion + 1,
    script_teleprompter: v.script_teleprompter,
    script_annotated: v.script_annotated,
    editing_report: v.editing_report,
    change_type: 'manual_edit',
    change_description: `Restaurado da versão ${v.version_number}`,
  })

  // Update script with restored content
  await supabase
    .from('scripts')
    .update({
      script_teleprompter: v.script_teleprompter,
      script_annotated: v.script_annotated,
      editing_report: v.editing_report,
      updated_at: new Date().toISOString(),
    })
    .eq('id', scriptId)
}

export async function createInvite(email: string): Promise<{
  ok: boolean
  email: string
  role?: string
  invite_link?: string
  invite_id?: string
  expires_at?: string
  warning?: string
}> {
  const { data, error } = await supabase.functions.invoke('create-invite', {
    body: { email },
  })
  if (error) throw new Error(await edgeErrorMessage(error, 'Falha ao criar convite'))
  if (data?.error) throw new Error(data.error)
  return data
}

/**
 * supabase-js mascara o corpo da resposta em erros non-2xx (FunctionsHttpError),
 * expondo só "Edge Function returned a non-2xx status code". Esta helper lê o
 * corpo JSON da resposta original (error.context) pra recuperar a mensagem real
 * que a Edge Function devolveu em `{ error: "..." }`.
 */
async function edgeErrorMessage(error: unknown, prefix: string): Promise<string> {
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json()
      if (body?.error) return body.error
    } catch {
      /* corpo não-JSON — cai no fallback abaixo */
    }
  }
  const msg = error instanceof Error ? error.message : String(error)
  return `${prefix}: ${msg}`
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('revoke-invite', {
    body: { invite_id: inviteId },
  })
  if (error) throw new Error(await edgeErrorMessage(error, 'Falha ao revogar convite'))
  if (data?.error) throw new Error(data.error)
}

export async function hasOwner(): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_owner')
  if (error) throw new Error(`Falha ao consultar status do owner: ${error.message}`)
  return Boolean(data)
}

export async function acceptNativeInvite(): Promise<void> {
  const { error } = await supabase.rpc('accept_native_invite')
  if (error) throw new Error(`Falha ao aceitar convite: ${error.message}`)
}

export async function generateScript(params: {
  topic: string;
  voice_profile_id?: string;
  reference_reel_ids?: string[];
  additional_instructions?: string;
  model_provider: ModelProvider;
  model_id: string;
}): Promise<{ job_id: string }> {
  const user_id = await getUserId();
  const { data, error } = await supabase.functions.invoke('generate-script', {
    body: { ...params, user_id },
  });

  if (error) {
    throw new Error(`Failed to start script generation: ${error.message}`);
  }

  return data as { job_id: string };
}

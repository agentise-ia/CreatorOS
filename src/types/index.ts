// ==========================================
// Database Types — Creator OS
// ==========================================

// --- Model Provider ---

export type ModelProvider = 'openai' | 'gemini';

export type ModelOption = {
  provider: ModelProvider;
  model: string;
  label: string;
  description?: string;
};

export const MODEL_OPTIONS: ModelOption[] = [
  { provider: 'openai', model: 'gpt-4.1', label: 'GPT-4.1', description: 'Robusto, contexto longo' },
  { provider: 'openai', model: 'gpt-4o', label: 'GPT-4o', description: 'Multimodal padrão, rápido' },
  { provider: 'gemini', model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Flagship Google — máxima capacidade' },
  { provider: 'gemini', model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Custo-benefício, baixa latência' },
  { provider: 'gemini', model: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Mais barato e rápido da família 2.5' },
];

// --- Profiles ---

export type Profile = {
  id: string;
  user_id: string;
  instagram_username: string;
  profile_type: 'reference' | 'own';
  full_name: string | null;
  followers_count: number | null;
  bio: string | null;
  profile_pic_url: string | null;
  last_scraped_at: string | null;
  created_at: string;
  updated_at: string;
};

// --- Reels ---

export type Reel = {
  id: string;
  profile_id: string;
  instagram_id: string;
  shortcode: string | null;
  caption: string | null;
  video_url: string | null;
  storage_path: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  views_count: number;
  engagement_score: number;
  music_name: string | null;
  music_artist: string | null;
  hashtags: string[];
  mentions: string[];
  posted_at: string | null;
  scraped_at: string;
  created_at: string;
};

// --- Transcriptions ---

export type TranscriptionWord = {
  word: string;
  start: number;
  end: number;
  confidence: number;
};

export type TranscriptionSegment = {
  start: number;
  end: number;
  text: string;
  words: TranscriptionWord[];
};

export type Transcription = {
  id: string;
  reel_id: string;
  full_text: string;
  language: string;
  segments: TranscriptionSegment[];
  whisper_model: string;
  processed_at: string;
};

// --- Content Analysis ---

export type HookAnalysis = {
  text: string;
  start_ts: number;
  end_ts: number;
  type: string;
  effectiveness_score: number;
};

export type DevelopmentAnalysis = {
  text: string;
  start_ts: number;
  end_ts: number;
  key_points: string[];
  storytelling_technique: string;
};

export type CTAAnalysis = {
  text: string;
  start_ts: number;
  end_ts: number;
  type: string;
  strength_score: number;
};

export type Transition = {
  type: string;
  timestamp: number;
  description: string;
};

export type MusicSegment = {
  start_ts: number;
  end_ts: number;
  mood: string;
  energy_level: string;
  genre: string;
};

export type SoundEffect = {
  timestamp: number;
  type: string;
  description: string;
};

export type BRollSegment = {
  start_ts: number;
  end_ts: number;
  description: string;
  visual_type: string;
};

export type TextOverlay = {
  start_ts: number;
  end_ts: number;
  text: string;
  style: string;
  position: string;
};

export type VisualEffect = {
  start_ts: number;
  end_ts: number;
  type: string;
  description: string;
};

export type ViralPatterns = {
  hook_type?: string;
  pacing?: string;
  retention_technique?: string;
  emotional_arc?: string;
  [key: string]: unknown;
};

export type ContentAnalysis = {
  id: string;
  reel_id: string;
  hook: HookAnalysis;
  development: DevelopmentAnalysis;
  cta: CTAAnalysis;
  transitions: Transition[];
  music_segments: MusicSegment[];
  sound_effects: SoundEffect[];
  broll_segments: BRollSegment[];
  text_overlays: TextOverlay[];
  visual_effects: VisualEffect[];
  viral_patterns: ViralPatterns;
  editing_analysis_status: 'pending' | 'processing' | 'completed' | 'failed';
  gemini_model: string | null;
  claude_model: string | null;
  analyzed_at: string;
};

// --- Voice Profile ---

export type VoiceProfile = {
  id: string;
  user_id: string;
  profile_id: string;
  vocabulary_style: string | null;
  sentence_structure: string | null;
  filler_words: string[];
  common_expressions: string[];
  tone_description: string | null;
  pacing_style: string | null;
  emotional_range: string | null;
  speech_patterns: Record<string, unknown> | null;
  full_profile_document: string;
  source_reel_ids: string[];
  generated_at: string;
  updated_at: string;
};

// --- Scripts ---

export type Script = {
  id: string;
  user_id: string;
  voice_profile_id: string | null;
  topic: string;
  reference_reel_ids: string[];
  additional_instructions: string | null;
  title: string;
  script_teleprompter: string;
  script_annotated: Record<string, unknown>;
  estimated_duration_seconds: number | null;
  editing_report: Record<string, unknown>;
  generation_model: string;
  viral_patterns_used: Record<string, unknown> | null;
  status: 'draft' | 'approved' | 'recorded' | 'published';
  created_at: string;
  updated_at: string;
};

// --- Script Versions ---

export type ScriptVersion = {
  id: string;
  script_id: string;
  version_number: number;
  script_teleprompter: string;
  script_annotated: Record<string, unknown>;
  editing_report: Record<string, unknown>;
  change_type: 'initial' | 'manual_edit' | 'ai_regeneration';
  change_description: string | null;
  created_at: string;
};

// --- Processing Jobs ---

export type ProcessingJob = {
  id: string;
  user_id: string;
  job_type: 'scrape' | 'analyze' | 'voice_profile' | 'generate_script';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  input_data: Record<string, unknown> | null;
  output_data: Record<string, unknown> | null;
  error_message: string | null;
  progress: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

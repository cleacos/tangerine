export interface VmRow {
  id: string
  label: string
  provider: string
  ip: string | null
  ssh_port: number | null
  status: string
  task_id: string | null
  snapshot_id: string
  region: string
  plan: string
  created_at: string
  updated_at: string
  error: string | null
  idle_since: string | null
}

export interface TaskRow {
  id: string
  project_id: string
  source: string
  source_id: string | null
  source_url: string | null
  repo_url: string
  title: string
  description: string | null
  status: string
  vm_id: string | null
  branch: string | null
  pr_url: string | null
  user_id: string | null
  opencode_session_id: string | null
  opencode_port: number | null
  preview_port: number | null
  error: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
}

export interface SessionLogRow {
  id: number
  task_id: string
  role: string
  content: string
  timestamp: string
}

export interface ImageRow {
  id: string
  name: string
  provider: string
  snapshot_id: string
  created_at: string
}

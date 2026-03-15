import { useState, useEffect, useCallback } from "react"
import type { TaskStatus, PoolStats, ProjectConfig } from "@tangerine/shared"
import { useTasks } from "../hooks/useTasks"
import { TaskList } from "../components/TaskList"
import { CreateTaskModal } from "../components/CreateTaskModal"
import { fetchPool, fetchProjects } from "../lib/api"

type FilterTab = "all" | TaskStatus

const filterTabs: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "created", label: "Created" },
  { id: "done", label: "Done" },
  { id: "failed", label: "Failed" },
]

export function Dashboard() {
  const [filter, setFilter] = useState<FilterTab>("all")
  const [showCreate, setShowCreate] = useState(false)
  const [pool, setPool] = useState<PoolStats | null>(null)
  const [projects, setProjects] = useState<ProjectConfig[]>([])
  const [selectedProject, setSelectedProject] = useState<string | undefined>(undefined)

  const statusFilter = filter === "all" ? undefined : filter
  const { tasks, loading, error, refetch } = useTasks({
    status: statusFilter,
    project: selectedProject,
  })

  const loadPool = useCallback(async () => {
    try {
      const data = await fetchPool()
      setPool(data)
    } catch {
      // Pool stats are non-critical
    }
  }, [])

  useEffect(() => {
    loadPool()
    const interval = setInterval(loadPool, 10000)
    return () => clearInterval(interval)
  }, [loadPool])

  useEffect(() => {
    fetchProjects()
      .then((data) => {
        setProjects(data)
      })
      .catch(() => {
        // Projects may not be available
      })
  }, [])

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-neutral-100">Tasks</h1>
          {projects.length > 1 && (
            <select
              value={selectedProject ?? ""}
              onChange={(e) => setSelectedProject(e.target.value || undefined)}
              className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-tangerine"
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {projects.length === 1 && (
            <span className="text-sm text-neutral-500">{projects[0]!.name}</span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {pool && (
            <div className="flex gap-3 text-xs text-neutral-500">
              <span title="Ready VMs">
                <span className="text-green-400">{pool.ready}</span> ready
              </span>
              <span title="Assigned VMs">
                <span className="text-blue-400">{pool.assigned}</span> assigned
              </span>
              <span title="Provisioning VMs">
                <span className="text-amber-400">{pool.provisioning}</span> provisioning
              </span>
            </div>
          )}

          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-tangerine px-4 py-2 text-sm font-medium text-white transition hover:bg-tangerine-light"
          >
            Create Task
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex gap-1 border-b border-neutral-800">
        {filterTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`px-3 py-2 text-sm transition ${
              filter === tab.id
                ? "border-b-2 border-tangerine text-tangerine"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-12 text-center text-sm text-neutral-500">
          Loading tasks...
        </div>
      ) : error ? (
        <div className="py-12 text-center text-sm text-red-400">
          {error}
        </div>
      ) : (
        <TaskList tasks={tasks} />
      )}

      {/* Create modal */}
      <CreateTaskModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={refetch}
        projects={projects}
        defaultProject={selectedProject}
      />
    </div>
  )
}

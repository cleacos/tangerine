import { useNavigate } from "react-router-dom"
import { useProject } from "../context/ProjectContext"
import { useTaskSearch } from "../hooks/useTaskSearch"
import { TasksSidebar } from "../components/TasksSidebar"
import { NewAgentForm } from "../components/NewAgentForm"
import { createTask } from "../lib/api"

export function Dashboard() {
  const navigate = useNavigate()
  const { current } = useProject()
  const { query, setQuery, tasks, refetch } = useTaskSearch(current?.name)

  const handleNewAgent = async (data: { projectId: string; title: string; description?: string }) => {
    try {
      const task = await createTask(data)
      refetch()
      navigate(`/tasks/${task.id}`)
    } catch {
      // TODO: show error toast
    }
  }

  return (
    <div className="flex h-full">
      <TasksSidebar
        tasks={tasks}
        searchQuery={query}
        onSearchChange={setQuery}
        onNewAgent={() => {/* already on new agent screen */}}
      />
      <NewAgentForm onSubmit={handleNewAgent} />
    </div>
  )
}

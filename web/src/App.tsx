import { Routes, Route } from "react-router-dom"
import { Layout } from "./components/Layout"
import { Dashboard } from "./pages/Dashboard"
import { TaskDetail } from "./pages/TaskDetail"
import { NewAgentPage } from "./pages/NewAgentPage"
import { ProjectProvider } from "./context/ProjectContext"

export function App() {
  return (
    <ProjectProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="new" element={<NewAgentPage />} />
          <Route path="tasks/:id" element={<TaskDetail />} />
        </Route>
      </Routes>
    </ProjectProvider>
  )
}

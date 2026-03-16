import { useState, useRef, useEffect } from "react"
import { Link, useLocation } from "react-router-dom"
import { useProject } from "../context/ProjectContext"

const projectColors = [
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-violet-500",
  "bg-orange-500",
  "bg-teal-500",
]

function getProjectColor(index: number) {
  return projectColors[index % projectColors.length]
}

export function Topbar() {
  const location = useLocation()
  const { projects, current, switchProject } = useProject()
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const isRuns = location.pathname === "/" || location.pathname.startsWith("/tasks")

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  const currentIndex = current ? projects.indexOf(current) : 0

  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#e5e5e5] bg-[#fafafa] px-4">
      {/* Left: Logo + project switcher */}
      <div className="flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#171717]">
            <svg className="h-3.5 w-3.5 text-[#fafafa]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611l-.772.13a18.142 18.142 0 0 1-6.126 0l-.772-.13c-1.717-.293-2.3-2.379-1.067-3.61L13 15" />
            </svg>
          </div>
          <span className="text-[15px] font-bold text-[#0a0a0a]">Tangerine</span>
        </Link>

        <div className="h-5 w-px bg-[#e5e5e5]" />

        {/* Project switcher */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 rounded-md bg-[#f5f5f5] px-2.5 py-1.5 transition hover:bg-[#ebebeb]"
          >
            {current && (
              <>
                <div className={`flex h-[18px] w-[18px] items-center justify-center rounded ${getProjectColor(currentIndex)}`}>
                  <span className="text-[10px] font-bold text-white">
                    {current.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="max-w-[180px] truncate text-[13px] font-medium text-[#0a0a0a]">
                  {current.name}
                </span>
              </>
            )}
            {!current && (
              <span className="text-[13px] text-[#737373]">No projects</span>
            )}
            <svg
              className={`h-3.5 w-3.5 text-[#737373] transition-transform ${open ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {open && projects.length > 0 && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] overflow-hidden rounded-lg border border-[#e5e5e5] bg-white shadow-lg">
              <div className="px-3 py-2">
                <span className="text-[11px] font-medium tracking-wider text-[#999]">PROJECTS</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {projects.map((project, i) => {
                  const isActive = project.name === current?.name
                  return (
                    <button
                      key={project.name}
                      onClick={() => {
                        switchProject(project.name)
                        setOpen(false)
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${
                        isActive ? "bg-[#f5f5f5]" : "hover:bg-[#fafafa]"
                      }`}
                    >
                      <div className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded ${getProjectColor(i)}`}>
                        <span className="text-[11px] font-bold text-white">
                          {project.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-medium text-[#0a0a0a]">
                          {project.name}
                        </span>
                        <span className="truncate text-[11px] text-[#999]">
                          {project.repo}
                        </span>
                      </div>
                      {isActive && (
                        <svg className="ml-auto h-3.5 w-3.5 shrink-0 text-[#0a0a0a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Center spacer */}
      <div className="flex-1" />

      {/* Right: Nav + actions */}
      <div className="flex items-center gap-2">
        <nav className="flex items-center gap-0.5">
          <Link
            to="/"
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${
              isRuns ? "bg-[#f5f5f5] text-[#0a0a0a]" : "text-[#737373] hover:text-[#0a0a0a]"
            }`}
          >
            Runs
          </Link>
        </nav>

      </div>
    </header>
  )
}

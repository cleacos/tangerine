import type { ChatMessage } from "../hooks/useSession"
import { getEventStyle } from "../lib/activity"
import { formatTimestamp, formatRelativeTime } from "../lib/format"

interface ActivityListProps {
  messages: ChatMessage[]
  /** "compact" = desktop sidebar (timestamp + truncated line). "timeline" = mobile (grouped by day with dots). */
  variant?: "compact" | "timeline"
}

export function ActivityList({ messages, variant = "compact" }: ActivityListProps) {
  const activities = messages.filter((m) => m.role === "assistant" || m.role === "tool" || m.role === "system")

  if (activities.length === 0) {
    return <div className="py-8 text-center text-[12px] text-[#737373]">No activity yet</div>
  }

  if (variant === "compact") {
    return (
      <div className="flex flex-col">
        <div className="flex h-7 items-center justify-between">
          <span className="font-mono text-[10px] font-medium tracking-wider text-[#737373]">ACTIVITY</span>
          <div className="flex items-center justify-center rounded-sm bg-[#f5f5f5] px-1.5">
            <span className="font-mono text-[10px] font-medium text-[#737373]">{activities.length}</span>
          </div>
        </div>
        <div className="flex flex-col">
          {activities.map((msg) => {
            const style = getEventStyle(msg.content)
            return (
              <div key={msg.id} className="flex gap-3 py-2">
                <span className="w-11 shrink-0 text-[11px] text-[#737373]">
                  {formatTimestamp(msg.timestamp)}
                </span>
                <div
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: style.bg }}
                >
                  <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: style.dot }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] text-[#0a0a0a]">{msg.content.slice(0, 80)}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Timeline variant — group by day
  const groups: { label: string; items: ChatMessage[] }[] = []
  let currentLabel = ""

  for (const msg of activities) {
    const d = new Date(msg.timestamp)
    const today = new Date()
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    const label = d.toDateString() === today.toDateString() ? "Today"
      : d.toDateString() === yesterday.toDateString() ? "Yesterday"
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })

    if (label !== currentLabel) {
      groups.push({ label, items: [] })
      currentLabel = label
    }
    groups[groups.length - 1]!.items.push(msg)
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      {groups.map((group) => (
        <div key={group.label} className="mb-6">
          <div className="mb-3 text-[12px] font-semibold text-[#a3a3a3]">{group.label}</div>
          <div className="flex flex-col gap-4">
            {group.items.map((msg) => {
              const style = getEventStyle(msg.content)
              return (
                <div key={msg.id} className="flex gap-3">
                  <div className="flex flex-col items-center pt-1">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: style.bg }}>
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: style.dot }} />
                    </div>
                    <div className="mt-1 w-px flex-1 bg-[#e5e5e5]" />
                  </div>
                  <div className="min-w-0 flex-1 pb-2">
                    <p className="text-[13px] font-medium leading-tight text-[#0a0a0a]">
                      {msg.content.slice(0, 100)}{msg.content.length > 100 && "..."}
                    </p>
                    <span className="mt-1 text-[11px] text-[#a3a3a3]">{formatRelativeTime(msg.timestamp)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

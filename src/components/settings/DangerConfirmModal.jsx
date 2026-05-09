/**
 * @param {{
 * title: string
 * body?: React.ReactNode
 * requiredText?: string
 * onCancel: () => void
 * onValidated: () => void | Promise<void>
 * busy?: boolean
 }} props
*/

export function DangerConfirmTypingModal({ title, body, requiredText = 'CONFIRM', onCancel, onValidated, busy }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 px-4 py-8">
      <form
        className="w-full max-w-md rounded-xl border border-[rgba(239,68,68,0.45)] bg-[#111118] p-6 shadow-2xl"
        onSubmit={async (e) => {
          e.preventDefault()

          const fd = new FormData(e.currentTarget)

          const typed = `${fd.get('ack') ?? ''}`

          if (typed !== requiredText) return

          await onValidated()
        }}
      >
        <h3 className="text-lg font-semibold text-[#FCA5A5]">{title}</h3>

        {body ? <div className="mt-3 text-sm leading-relaxed text-[#D6D6E8]">{body}</div> : null}

        <label className="mt-4 block space-y-1 font-mono text-[11px] text-[#9090A8]">
          Type <span className="text-[#F87171]">{requiredText}</span>

          <input
            name="ack"
            type="text"
            autoComplete="off"
            required
            className="mt-1 w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[#0A0A0F] px-3 py-2 font-mono text-sm text-[#F0F0F8] outline-none focus:border-[rgba(239,68,68,0.55)]"
            placeholder={requiredText}
          />
        </label>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" className="rounded-md border border-[rgba(255,255,255,0.12)] px-4 py-2 font-mono text-xs" onClick={onCancel}>
            Cancel
          </button>

          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-[rgba(239,68,68,0.55)] bg-[rgba(239,68,68,0.12)] px-4 py-2 font-mono text-xs text-[#FECACA] disabled:opacity-40"
          >
            Confirm
          </button>
        </div>
      </form>
    </div>
  )
}
